import { Image } from 'expo-image'
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { useScreenshotLightboxStore } from '@/store/screenshotLightboxStore'

// Mount exactly once, near the app root (src/app/_layout.tsx) — see screenshotLightboxStore.ts for
// why this can't be a <Modal> embedded inside the Game detail screen's own scrolled component tree.
export function ScreenshotLightboxHost() {
    const { visible, urls, index, close, next, prev } = useScreenshotLightboxStore()
    const url = urls[index]

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
            <View style={styles.backdrop}>
                <Pressable style={styles.close} onPress={close} hitSlop={12}>
                    <Text style={styles.closeText}>×</Text>
                </Pressable>
                {url && <Image source={{ uri: url }} style={styles.image} contentFit="contain" />}
                {urls.length > 1 && (
                    <View style={styles.nav}>
                        <Pressable style={styles.navBtn} onPress={prev}>
                            <Text style={styles.navText}>‹</Text>
                        </Pressable>
                        <Pressable style={styles.navBtn} onPress={next}>
                            <Text style={styles.navText}>›</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    // react-native-web's own <Modal> wraps children in an inner `{top:0, flex:1}` container whose
    // resolved height doesn't reliably fill the viewport (confirmed: an absolutely-positioned
    // child of that container left a real gap at the true viewport top, with page content behind
    // it visible through the gap, reproduced from a fresh dev server with no HMR/caching involved).
    // Fix: position this backdrop as `fixed` directly (bypassing the parent flex container's box
    // entirely) on web; native's Modal has no such DOM/flex quirk, so `absolute` + absoluteFill
    // remains correct there.
    backdrop: {
        ...StyleSheet.absoluteFill,
        ...(Platform.OS === 'web' ? { position: 'fixed' as 'absolute' } : null),
        backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '80%' },
    close: { position: 'absolute', top: 40, right: 20, zIndex: 1 },
    closeText: { color: '#fff', fontSize: 32 },
    nav: { position: 'absolute', top: '50%', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
    navBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    navText: { color: '#fff', fontSize: 24 },
})
