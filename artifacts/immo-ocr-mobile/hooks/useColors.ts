import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the colour palette that matches the current system colour scheme.
 * Usage:  const colors = useColors();
 */
export function useColors() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? colors.dark : colors.light;
}
