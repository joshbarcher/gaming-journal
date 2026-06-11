<script>
    import { onMount } from 'svelte'
    import { api } from '../../js/api.js'
    import { refreshSidebarItem } from '../../js/sidebar.js'
    import { parseListItems, applyIndent, renderListItems } from '../../js/views/page-helpers.js'
    import { navigate } from '../../js/router.js'

    const TOGGLE_CMDS = [
        { cmd: 'bold',      label: 'B', title: 'Bold (Ctrl+B)' },
        { cmd: 'italic',    label: 'I', title: 'Italic (Ctrl+I)' },
        { cmd: 'underline', label: 'U', title: 'Underline (Ctrl+U)' },
    ]

    const FONT_SIZES = [
        { label: 'Small',  value: '2' },
        { label: 'Normal', value: '3' },
        { label: 'Large',  value: '5' },
        { label: 'XL',     value: '7' },
    ]

    const FONT_FAMILIES = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana']

    let { page: pageProp } = $props()

    let pd        = $state(JSON.parse(JSON.stringify(pageProp)))
    let editorEl  = null
    let saveTimer = null

    let boldActive      = $state(false)
    let italicActive    = $state(false)
    let underlineActive = $state(false)
    let listActive      = $state(false)

    function isActive(cmd) {
        if (cmd === 'bold')      return boldActive
        if (cmd === 'italic')    return italicActive
        if (cmd === 'underline') return underlineActive
        return false
    }

    function updateToolbarState() {
        boldActive      = document.queryCommandState('bold')
        italicActive    = document.queryCommandState('italic')
        underlineActive = document.queryCommandState('underline')
        listActive      = document.queryCommandState('insertUnorderedList')
    }

    function execCmd(cmd) {
        document.execCommand(cmd, false)
        updateToolbarState()
    }

    function onSelectionChange() {
        if (!editorEl) return
        if (!editorEl.contains(document.activeElement) && document.activeElement !== editorEl) return
        updateToolbarState()
    }

    function onEditorInput() {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(save, 600)
    }

    function onEditorKeydown(e) {
        if (e.key === ' ') {
            const sel = window.getSelection()
            if (sel?.rangeCount) {
                const range = sel.getRangeAt(0)
                if (range.collapsed) {
                    const node = range.startContainer
                    if (node.nodeType === 3) {
                        const textBefore = node.textContent.slice(0, range.startOffset)
                        if (textBefore === '-' || textBefore === '*') {
                            e.preventDefault()
                            const r2 = document.createRange()
                            r2.setStart(node, 0)
                            r2.setEnd(node, range.startOffset)
                            sel.removeAllRanges()
                            sel.addRange(r2)
                            document.execCommand('delete', false)
                            document.execCommand('insertUnorderedList', false)
                            return
                        }
                    }
                }
            }
        }

        if (e.key === 'Tab') {
            const list = containingList()
            if (list) {
                e.preventDefault()
                handleListIndent(list, e.shiftKey)
            }
        }
    }

    function containingList() {
        const sel = window.getSelection()
        if (!sel?.rangeCount) return null
        let node = sel.getRangeAt(0).startContainer
        while (node && node !== editorEl) {
            if (node.tagName === 'UL' || node.tagName === 'OL') return node
            node = node.parentElement
        }
        return null
    }

    function handleListIndent(list, outdent) {
        const sel = window.getSelection()
        if (!sel.rangeCount) return

        const range  = sel.getRangeAt(0)
        const allLis = Array.from(list.querySelectorAll('li'))

        const liOf = node => {
            const el = node.nodeType === 3 ? node.parentElement : node
            return el.closest('li')
        }

        const startIdx = allLis.indexOf(liOf(range.startContainer))
        if (startIdx === -1) return

        let endIdx = startIdx
        if (!range.collapsed) {
            const endLi  = liOf(range.endContainer)
            const endPos = allLis.indexOf(endLi)
            if (endPos > startIdx) endIdx = endPos
        }

        const tag     = list.tagName.toLowerCase()
        const items   = parseListItems(list)
        const updated = applyIndent(items, startIdx, endIdx, outdent)
        list.innerHTML = renderListItems(updated, tag)

        const newLis = Array.from(list.querySelectorAll('li'))
        const first  = newLis[Math.min(startIdx, newLis.length - 1)]
        const last   = newLis[Math.min(endIdx,   newLis.length - 1)]
        if (first) {
            const r = document.createRange()
            r.setStart(first, 0)
            r.setEnd(last, last.childNodes.length)
            sel.removeAllRanges()
            sel.addRange(r)
        }

        clearTimeout(saveTimer)
        saveTimer = setTimeout(save, 600)
    }

    async function onTitleBlur(e) {
        const t = e.currentTarget.textContent.trim()
        if (!t || t === pd.title) { e.currentTarget.textContent = pd.title; return }
        pd.title = t
        const updated = await api.pages.update(pd.id, { title: t })
        if (updated) refreshSidebarItem(updated)
    }

    async function save() {
        if (!editorEl) return
        const content = editorEl.innerHTML
        if (content === pd.content) return
        pd.content = content
        await api.pages.update(pd.id, { content })
    }

    onMount(() => {
        if (editorEl) editorEl.innerHTML = pd.content || '<p><br></p>'
        document.addEventListener('selectionchange', onSelectionChange)
        return () => document.removeEventListener('selectionchange', onSelectionChange)
    })
</script>

{#if pd.appid}
    <a class="gj-sub-back" href="/journal/{pd.appid}/pages"
       onclick={(e) => { e.preventDefault(); navigate(`journal/${pd.appid}/pages`) }}>← Journal Pages</a>
{/if}

<div class="page-header">
    <h1 class="page-title page-title--editable" contenteditable="true"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onblur={onTitleBlur}>{pd.title}</h1>
    <p class="page-subtitle">Page · Rich Text</p>
</div>

<div class="rt-toolbar">
    {#each TOGGLE_CMDS as {cmd, label, title}}
        <button class="rt-btn" class:active={isActive(cmd)} {title}
                onmousedown={(e) => { e.preventDefault(); execCmd(cmd) }}>{label}</button>
    {/each}
    <div class="rt-sep"></div>
    <button class="rt-btn" class:active={listActive}
            title="Bullet list (Tab/Shift+Tab to indent)"
            onmousedown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList', false); updateToolbarState() }}>&#8226; List</button>
    <div class="rt-sep"></div>
    <span class="rt-toolbar-label">Size</span>
    <select class="rt-select" title="Font size"
            onmousedown={(e) => e.stopPropagation()}
            onchange={(e) => { document.execCommand('fontSize', false, e.target.value); editorEl?.focus() }}>
        {#each FONT_SIZES as {label, value}}
            <option {value}>{label}</option>
        {/each}
    </select>
    <div class="rt-sep"></div>
    <span class="rt-toolbar-label">Font</span>
    <select class="rt-select rt-select--font" title="Font family"
            onmousedown={(e) => e.stopPropagation()}
            onchange={(e) => { document.execCommand('fontName', false, e.target.value); editorEl?.focus() }}>
        {#each FONT_FAMILIES as font}
            <option value={font} style="font-family:{font}">{font}</option>
        {/each}
    </select>
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rt-editor" contenteditable="true" bind:this={editorEl}
     oninput={onEditorInput}
     onkeydown={onEditorKeydown}></div>
