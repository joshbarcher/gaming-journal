export function inputDialog(title: string, placeholder = '', defaultValue = ''): Promise<string | null> {
    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'dialog-overlay'

        const box = document.createElement('div')
        box.className = 'dialog-box'

        const titleEl = document.createElement('div')
        titleEl.className = 'dialog-title'
        titleEl.textContent = title

        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'dialog-input'
        input.placeholder = placeholder
        input.value = defaultValue

        const actions = document.createElement('div')
        actions.className = 'dialog-actions'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'dialog-btn dialog-btn--cancel'
        cancelBtn.textContent = 'Cancel'

        const okBtn = document.createElement('button')
        okBtn.className = 'dialog-btn dialog-btn--create'
        okBtn.textContent = 'OK'

        const close = (result: string | null) => {
            overlay.remove()
            document.removeEventListener('keydown', onKey)
            resolve(result)
        }

        function submit() {
            const v = input.value.trim()
            if (!v) { input.focus(); return }
            close(v)
        }

        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') close(null)
        }

        cancelBtn.addEventListener('click', () => close(null))
        okBtn.addEventListener('click', submit)
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') close(null)
        })
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null) })
        document.addEventListener('keydown', onKey)

        actions.appendChild(cancelBtn)
        actions.appendChild(okBtn)
        box.appendChild(titleEl)
        box.appendChild(input)
        box.appendChild(actions)
        overlay.appendChild(box)
        document.body.appendChild(overlay)

        input.focus()
        input.select()
    })
}

export function showError(message: string): void {
    const el = document.createElement('div')
    el.className = 'error-toast'
    el.textContent = message
    document.body.appendChild(el)
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('error-toast--show')))
    setTimeout(() => {
        el.classList.remove('error-toast--show')
        setTimeout(() => el.remove(), 350)
    }, 4000)
}

const PAGE_TYPES = [
    { value: 'progress',      label: 'Progress Tracker',   desc: 'Tasks with Start / Working / Done states' },
    { value: 'progress-bars', label: 'Multi-Bar Progress',  desc: 'Multiple segmented progress bars' },
    { value: 'list',          label: 'List',                desc: 'Ordered or unordered checklist' },
    { value: 'notes',         label: 'Notes',               desc: 'Freeform notes collection' },
    { value: 'page',          label: 'Page',                desc: 'Rich text content page' },
]

export function confirmDialog(title: string, body: string, confirmLabel = 'Confirm'): Promise<boolean> {
    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'dialog-overlay'

        const box = document.createElement('div')
        box.className = 'dialog-box'

        const titleEl = document.createElement('div')
        titleEl.className = 'dialog-title'
        titleEl.textContent = title

        const bodyEl = document.createElement('div')
        bodyEl.className = 'dialog-body'
        bodyEl.textContent = body

        const actions = document.createElement('div')
        actions.className = 'dialog-actions'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'dialog-btn dialog-btn--cancel'
        cancelBtn.textContent = 'Cancel'

        const confirmBtn = document.createElement('button')
        confirmBtn.className = 'dialog-btn dialog-btn--confirm'
        confirmBtn.textContent = confirmLabel

        const close = (result: boolean) => {
            overlay.remove()
            document.removeEventListener('keydown', onKey)
            resolve(result)
        }

        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') close(false)
            if (e.key === 'Enter')  close(true)
        }

        cancelBtn.addEventListener('click', () => close(false))
        confirmBtn.addEventListener('click', () => close(true))
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false) })
        document.addEventListener('keydown', onKey)

        actions.appendChild(cancelBtn)
        actions.appendChild(confirmBtn)
        box.appendChild(titleEl)
        box.appendChild(bodyEl)
        box.appendChild(actions)
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        confirmBtn.focus()
    })
}

export function newPageDialog(): Promise<{ title: string; type: string } | null> {
    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'dialog-overlay'

        const box = document.createElement('div')
        box.className = 'dialog-box'

        const titleEl = document.createElement('div')
        titleEl.className = 'dialog-title'
        titleEl.textContent = 'New Page'

        const titleLabel = document.createElement('label')
        titleLabel.className = 'dialog-label'
        titleLabel.textContent = 'Title'

        const titleInput = document.createElement('input')
        titleInput.type = 'text'
        titleInput.className = 'dialog-input'
        titleInput.placeholder = 'Page title…'

        const typeLabel = document.createElement('div')
        typeLabel.className = 'dialog-label'
        typeLabel.textContent = 'Type'

        const typeList = document.createElement('div')
        typeList.className = 'dialog-type-list'

        let selectedType = PAGE_TYPES[0].value

        for (const pt of PAGE_TYPES) {
            const row = document.createElement('label')
            row.className = 'dialog-type-row'

            const radio = document.createElement('input')
            radio.type = 'radio'
            radio.name = 'page-type'
            radio.value = pt.value
            if (pt.value === selectedType) radio.checked = true
            radio.addEventListener('change', () => { selectedType = pt.value })

            const text = document.createElement('span')
            text.className = 'dialog-type-text'
            text.innerHTML = `<strong>${pt.label}</strong><span class="dialog-type-desc"> — ${pt.desc}</span>`

            row.appendChild(radio)
            row.appendChild(text)
            typeList.appendChild(row)
        }

        const actions = document.createElement('div')
        actions.className = 'dialog-actions'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'dialog-btn dialog-btn--cancel'
        cancelBtn.textContent = 'Cancel'

        const createBtn = document.createElement('button')
        createBtn.className = 'dialog-btn dialog-btn--create'
        createBtn.textContent = 'Create'

        const close = (result: { title: string; type: string } | null) => {
            overlay.remove()
            document.removeEventListener('keydown', onKey)
            resolve(result)
        }

        function submit() {
            const t = titleInput.value.trim()
            if (!t) { titleInput.focus(); return }
            close({ title: t, type: selectedType })
        }

        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') close(null)
            if (e.key === 'Enter' && e.target !== titleInput) submit()
        }

        cancelBtn.addEventListener('click', () => close(null))
        createBtn.addEventListener('click', submit)
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit()
        })
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
        document.addEventListener('keydown', onKey)

        actions.appendChild(cancelBtn)
        actions.appendChild(createBtn)
        box.appendChild(titleEl)
        box.appendChild(titleLabel)
        box.appendChild(titleInput)
        box.appendChild(typeLabel)
        box.appendChild(typeList)
        box.appendChild(actions)
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        titleInput.focus()
    })
}
