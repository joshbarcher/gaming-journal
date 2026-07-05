import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist'

// Thin wrapper around react-native-draggable-flatlist — the shared drag-reorder primitive for the
// 6 features that need it (backlog, in-progress, franchise entries, list-page items/subtasks,
// tracker bars/chips). Requires <GestureHandlerRootView> at the app root (wired in _layout.tsx).
//
// Drag is triggered by whatever the caller's renderItem wires to the provided `drag` callback —
// typically onLongPress on the row (same long-press vocabulary as LongPressMenu elsewhere in this
// app), leaving onPress free for the row's normal tap action (navigate, toggle, etc). This wrapper
// doesn't enforce that choice — screens differ (e.g. list-page's two-tier item/subtask drag needs
// more care) so it's left to each call site.
export type DraggableListRenderItem<T> = RenderItemParams<T>

export function DraggableList<T>({
    data,
    keyExtractor,
    renderItem,
    onReorder,
    ListHeaderComponent,
    ListFooterComponent,
    contentContainerStyle,
    style,
}: {
    data: T[]
    keyExtractor: (item: T) => string
    renderItem: (params: DraggableListRenderItem<T>) => React.ReactElement
    onReorder: (newData: T[]) => void
    // Added for the Progress tracker detail screen — a page with a header (title/segment bar) and
    // footer (Add Task button + notes textarea) around the draggable list itself, all needing to be
    // ONE scrollable region. DraggableFlatList already wraps its own FlatList's scroll handling
    // (required for auto-scroll-while-dragging near the edges to work at all) — wrapping it in a
    // second outer ScrollView would trigger the "VirtualizedList nested inside a plain ScrollView"
    // warning seen elsewhere this session, so header/footer content passes through the FlatList's
    // own props instead of surrounding it.
    ListHeaderComponent?: React.ComponentType<unknown> | React.ReactElement | null
    ListFooterComponent?: React.ComponentType<unknown> | React.ReactElement | null
    contentContainerStyle?: import('react-native').ViewStyle
    // Real bug caught during the Progress tracker item's first screenshot: with no `style` passed,
    // the FlatList's own background defaulted to plain white (not the app's dark theme), since every
    // *other* DraggableList call site (Backlog/In-Progress/Franchises) sits inside its own already-
    // themed outer ScrollView/View — this is the first call site where DraggableList IS the whole
    // screen, so it has to carry the theme background itself instead of inheriting one.
    style?: import('react-native').ViewStyle
}) {
    return (
        <DraggableFlatList
            data={data}
            keyExtractor={(item) => keyExtractor(item)}
            renderItem={renderItem}
            onDragEnd={({ data: reordered }) => onReorder(reordered)}
            ListHeaderComponent={ListHeaderComponent}
            ListFooterComponent={ListFooterComponent}
            contentContainerStyle={contentContainerStyle}
            style={style}
        />
    )
}
