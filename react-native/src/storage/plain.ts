import AsyncStorage from '@react-native-async-storage/async-storage'

// The web app deliberately splits persisted UI state into two tiers (see collections/library.md
// "State persistence"): sort/dir use plain localStorage (persist indefinitely — a user's sort
// preference shouldn't randomly reset), while page/scroll/query/letter use setWithTTL (expire —
// stale filter state shouldn't survive forever). ttl.ts covers the second tier; this thin
// AsyncStorage wrapper covers the first, kept as a separate module so the distinction stays
// visible in the code, not just in a comment.
export async function getPlain(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key)
}

export async function setPlain(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value)
}
