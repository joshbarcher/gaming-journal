import { Stack } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Detail routes live INSIDE the (drawer) group so they inherit the permanent rail at
// tablet-landscape/desktop (the web keeps its sidebar on every page). Headerless nested stack —
// the drawer rail is the nav, each screen renders its own in-content chrome. The drawer scene
// handles the BOTTOM inset globally; because these have no drawer header, the stack applies the
// TOP inset so content clears the status bar.
export default function CommunityStackLayout() {
    const insets = useSafeAreaInsets()
    return <Stack screenOptions={{ headerShown: false, contentStyle: { paddingTop: insets.top } }} />
}
