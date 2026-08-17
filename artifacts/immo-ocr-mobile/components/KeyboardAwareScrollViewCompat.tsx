import React from 'react';
import { Platform, ScrollView, ScrollViewProps } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

// Omit children from both props to avoid a type conflict between the two
// packages' ReactNode definitions, then re-add it as React.ReactNode.
type Props = Omit<KeyboardAwareScrollViewProps & ScrollViewProps, 'children'> & {
  children?: React.ReactNode;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  ...props
}: Props) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...(props as KeyboardAwareScrollViewProps)}
    >
      {children as any}
    </KeyboardAwareScrollView>
  );
}
