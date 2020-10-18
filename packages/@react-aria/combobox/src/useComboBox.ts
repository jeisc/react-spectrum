/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {AriaButtonProps} from '@react-types/button';
import {chain, mergeProps, useLabels} from '@react-aria/utils';
import {ComboBoxProps} from '@react-types/combobox';
import {ComboBoxState} from '@react-stately/combobox';
import {getItemId, listIds} from '@react-aria/listbox';
import {HTMLAttributes, InputHTMLAttributes, RefObject, useEffect, useRef} from 'react';
// @ts-ignore
import intlMessages from '../intl/*.json';
import {ListLayout} from '@react-stately/layout';
import {Collection, PressEvent, Node} from '@react-types/shared';
import {useMenuTrigger} from '@react-aria/menu';
import {announce} from '@react-aria/live-announcer';
import {useMessageFormatter} from '@react-aria/i18n';
import {usePress} from '@react-aria/interactions';
import {useSelectableCollection} from '@react-aria/selection';
import {useTextField} from '@react-aria/textfield';

export interface AriaComboBoxProps<T> extends ComboBoxProps<T> {
  popoverRef: RefObject<HTMLDivElement>,
  triggerRef: RefObject<HTMLElement>,
  inputRef: RefObject<HTMLInputElement & HTMLTextAreaElement>,
  layout: ListLayout<T>,
  menuId?: string
}

interface ComboBoxAria {
  triggerProps: AriaButtonProps,
  inputProps: InputHTMLAttributes<HTMLInputElement>,
  listBoxProps: HTMLAttributes<HTMLElement>,
  labelProps: HTMLAttributes<HTMLElement>
}

export function useComboBox<T>(props: AriaComboBoxProps<T>, state: ComboBoxState<T>): ComboBoxAria {
  let {
    triggerRef,
    popoverRef,
    inputRef,
    layout,
    completionMode = 'suggest',
    isReadOnly,
    isDisabled,
    menuId
  } = props;

  let formatMessage = useMessageFormatter(intlMessages);
  let {menuTriggerProps, menuProps} = useMenuTrigger(
    {
      type: 'listbox'
    },
    state,
    triggerRef
  );

  // TODO: perhaps I should alter useMenuTrigger/useOverlayTrigger to accept a user specified menuId
  // Had to set the list id here instead of in useListBox or ListBoxBase so that it would be properly defined
  // when getting focusedKeyId
  listIds.set(state, menuId || menuProps.id);

  let focusedItem = state.selectionManager.focusedKey && state.isOpen ? state.collection.getItem(state.selectionManager.focusedKey) : undefined;
  let focusedKeyId = focusedItem ? getItemId(state, focusedItem.key) : undefined;

  // Using layout initiated from ComboBox, generate the keydown handlers for textfield (arrow up/down to navigate through menu when focus in the textfield)
  let {collectionProps} = useSelectableCollection({
    selectionManager: state.selectionManager,
    keyboardDelegate: layout,
    disallowTypeAhead: true,
    disallowEmptySelection: true,
    disallowSelectAll: true,
    ref: inputRef
  });

  // For textfield specific keydown operations
  let onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
      case 'Tab':
        state.commit();
        break;
      case 'Escape':
        state.close();
        break;
      case 'ArrowDown':
        state.open('first');
        break;
      case 'ArrowUp':
        state.open('last');
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        state.selectionManager.setFocusedKey(null);
        break;
    }
  };

  let onBlur = (e: React.FocusEvent) => {
    // Early return in the following cases so we don't change textfield focus state, update the selected key erroneously,
    // and trigger close menu twice:
    // If focus is moved into the popover (e.g. when focus is moved to the Tray's input field, mobile case).
    // If the tray input is blurred and the relatedTarget is null (e.g. switching browser tabs or tapping on the tray empty space)
    // The second case results in a inaccurate isFocused state if tray input is blurred by closing the virtual keyboard but we want isFocused to be true so
    // useComboBoxState isOpen calculation doesn't think it should close
    if (popoverRef.current?.contains(e.relatedTarget as HTMLElement)) {
      return;
    }

    if (props.onBlur) {
      props.onBlur(e);
    }

    state.setFocused(false);
  };

  let onFocus = (e: React.FocusEvent) => {
    if (state.isFocused) {
      return;
    }

    if (props.onFocus) {
      props.onFocus(e);
    }

    state.setFocused(true);
  };

  let {labelProps, inputProps} = useTextField({
    ...props,
    onChange: state.setInputValue,
    onKeyDown: !isReadOnly && chain(state.isOpen && collectionProps.onKeyDownCapture, onKeyDown),
    onBlur,
    value: state.inputValue,
    onFocus,
    autoComplete: 'off'
  }, inputRef);

  // Don't need to handle the state.close() when pressing the trigger button since useInteractOutside will call it for us
  let onPress = (e: PressEvent) => {
    if (e.pointerType === 'touch') {
      // Focus the input field in case it isn't focused yet
      inputRef.current.focus();
      if (!state.isOpen) {
        state.open();
      }
    }
  };

  let onPressStart = (e: PressEvent) => {
    if (e.pointerType !== 'touch') {
      inputRef.current.focus();
      if (!state.isOpen) {
        state.open((e.pointerType === 'keyboard' || e.pointerType === 'virtual') ? 'first' : null);
      }
    }
  };

  let triggerLabelProps = useLabels({
    id: menuTriggerProps.id,
    'aria-label': formatMessage('buttonLabel'),
    'aria-labelledby': props['aria-labelledby'] || labelProps.id
  });

  let listBoxProps = useLabels({
    id: menuProps.id,
    'aria-label': formatMessage('listboxLabel'),
    'aria-labelledby': props['aria-labelledby'] || labelProps.id
  });

  // If click happens on direct center of combobox input, might be virtual click from iPad so open combobox menu
  let onClick = (e: React.MouseEvent) => {
    if (isDisabled || isReadOnly) {
      return;
    }

    let rect = (e.target as HTMLElement).getBoundingClientRect();

    let middleOfRect = {
      x: Math.round(rect.left + .5 * rect.width),
      y: Math.round(rect.top + .5 * rect.height)
    };

    if (e.clientX === middleOfRect.x && e.clientY === middleOfRect.y) {
      // inputRef.current.focus();
      // state.toggle();
    }
  };

  // VoiceOver has issues with announcing aria-activedescendant properly on change
  // (especially on iOS). We use a live region announcer to announce focus changes
  // manually. In addition, section titles are announced when navigating into a new section.
  let sectionKey = focusedItem?.parentKey ?? null;
  let itemKey = state.selectionManager.focusedKey ?? null;
  let lastSection = useRef(sectionKey);
  let lastItem = useRef(itemKey);
  useEffect(() => {
    if (focusedItem != null && itemKey !== lastItem.current) {
      let isSelected = state.selectionManager.isSelected(itemKey);
      let section = sectionKey != null ? state.collection.getItem(sectionKey) : null;
      let sectionTitle = section?.['aria-label'] || (typeof section?.rendered === 'string' ? section.rendered : '') || '';

      let announcement = formatMessage('focusAnnouncement', {
        isGroupChange: section && sectionKey !== lastSection.current,
        groupTitle: sectionTitle,
        groupCount: section ? [...section.childNodes].length : 0,
        optionText: focusedItem['aria-label'] || focusedItem.textValue || '',
        isSelected
      });

      announce(announcement);
    }

    lastSection.current = sectionKey;
    lastItem.current = itemKey;
  }, [sectionKey, itemKey, focusedItem]);

  // Announce the number of available suggestions when it changes
  let optionCount = getOptionCount(state.collection);
  let lastSize = useRef(optionCount);
  let lastOpen = useRef(state.isOpen);
  useEffect(() => {
    if (state.isOpen && (state.isOpen !== lastOpen.current || optionCount !== lastSize.current)) {
      let announcement = formatMessage('countAnnouncement', {optionCount});
      announce(announcement);
    }

    lastSize.current = optionCount;
    lastOpen.current = state.isOpen;
  }, [state.isOpen, optionCount]);

  // Announce when a selection occurs
  let lastSelectedKey = useRef(state.selectedKey);
  useEffect(() => {
    if (state.isFocused && state.selectedItem && state.selectedKey !== lastSelectedKey.current) {
      let optionText = state.selectedItem['aria-label'] || state.selectedItem.textValue || '';
      let announcement = formatMessage('selectedAnnouncement', {optionText});
      announce(announcement);
    }

    lastSelectedKey.current = state.selectedKey;
  }, [state.selectedKey, state.selectedItem, state.isFocused]);

  return {
    labelProps,
    triggerProps: {
      ...menuTriggerProps,
      ...triggerLabelProps,
      excludeFromTabOrder: true,
      onPress,
      onPressStart
    },
    inputProps: mergeProps(inputProps, {
      role: 'combobox',
      'aria-expanded': menuTriggerProps['aria-expanded'],
      'aria-controls': state.isOpen ? menuId || menuProps.id : undefined,
      'aria-autocomplete': completionMode === 'suggest' ? 'list' : 'both',
      'aria-activedescendant': focusedKeyId,
      onClick
    }),
    listBoxProps: mergeProps(menuProps, listBoxProps)
  };
}

function getOptionCount<T>(collection: Iterable<Node<T>>): number {
  let count = 0;
  for (let item of collection) {
    if (item.type === 'section') {
      count += getOptionCount(item.childNodes);
    } else {
      count++;
    }
  }

  return count;
}
