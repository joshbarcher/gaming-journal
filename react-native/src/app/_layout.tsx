import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ComponentProps } from 'react';
import { useFonts } from 'expo-font';
import { Slot, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { persistOptions, queryClient } from '@/api/queryClient';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ConfirmDialogHost } from '@/components/shared/ConfirmDialog';
import { GlobalSearchHost } from '@/components/shared/GlobalSearch';
import { GuidesModalHost } from '@/components/shared/GuidesModalHost';
import { GuideTocHost } from '@/components/shared/GuideTocHost';
import { LongPressMenuHost } from '@/components/shared/LongPressMenu';
import { ParticlesHost } from '@/components/shared/ParticlesHost';
import { ReviewEditor } from '@/components/shared/ReviewEditor';
import { ScreenshotLightboxHost } from '@/components/shared/ScreenshotLightbox';
import { colors, fonts } from '@/theme/tokens';
import { fontsToLoad } from '@/theme/fonts';

SplashScreen.preventAutoHideAsync();

// The web app has exactly one theme (dark) — no light-mode variant exists anywhere in its CSS
// (confirmed in PLAN.md) — so this is a fixed navigation theme, not a system-color-scheme switcher.
// Typed structurally off ThemeProvider's own prop rather than importing @react-navigation/native
// directly — SDK 56+ expo-router doesn't want raw react-navigation packages as direct deps (see
// the DrawerContent.tsx note on the same issue).
type NavTheme = NonNullable<ComponentProps<typeof ThemeProvider>['value']>
const navigationTheme: NavTheme = {
  dark: true,
  colors: {
    primary:      colors.accent,
    background:   colors.bg,
    card:         colors.bgRaised,
    text:         colors.text,
    border:       colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular:  { fontFamily: fonts.ui, fontWeight: '400' },
    medium:   { fontFamily: fonts.ui, fontWeight: '500' },
    bold:     { fontFamily: fonts.uiBold, fontWeight: '700' },
    heavy:    { fontFamily: fonts.uiBold, fontWeight: '800' },
  },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts(fontsToLoad);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    // Required by react-native-draggable-flatlist (and gesture-handler generally) — must wrap the
    // whole app, added now as the DraggableList shared component is built (Phase 1).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <ThemeProvider value={navigationTheme}>
          <AnimatedSplashOverlay />
          <Slot />
          <ConfirmDialogHost />
          <LongPressMenuHost />
          <GlobalSearchHost />
          <ScreenshotLightboxHost />
          <ReviewEditor />
          <GuidesModalHost />
          <GuideTocHost />
          <ParticlesHost />
        </ThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
