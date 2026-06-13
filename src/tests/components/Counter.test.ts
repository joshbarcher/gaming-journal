import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import Counter from '../../lib/svelte/counter/Counter.svelte'

vi.mock('../../lib/js/api.js', () => ({
    api: { pages: { update: vi.fn().mockResolvedValue(null), remove: vi.fn().mockResolvedValue(true) } },
}))
vi.mock('../../lib/js/dialog.js',  () => ({ confirmDialog: vi.fn().mockResolvedValue(false) }))
vi.mock('../../lib/js/sidebar.js', () => ({ refreshSidebarItem: vi.fn() }))
vi.mock('../../lib/js/router.js',  () => ({ navigate: vi.fn() }))

function makePage(overrides = {}) {
    return {
        id:      'page-1',
        type:    'counter',
        title:   'Boss Kills',
        current: 3,
        target:  10,
        appid:   null,
        ...overrides,
    }
}

describe('Counter component', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('renders the page title', () => {
        const { getByText } = render(Counter, { props: { page: makePage() } })
        expect(getByText('Boss Kills')).toBeTruthy()
    })

    it('renders the current value', () => {
        const { getByText } = render(Counter, { props: { page: makePage({ current: 3 }) } })
        expect(getByText('3')).toBeTruthy()
    })

    it('renders the target value', () => {
        const { getByText } = render(Counter, { props: { page: makePage({ target: 10 }) } })
        expect(getByText('10')).toBeTruthy()
    })

    it('renders the percentage', () => {
        const { getByText } = render(Counter, { props: { page: makePage({ current: 5, target: 10 }) } })
        expect(getByText('50%')).toBeTruthy()
    })

    it('shows 0% when current is 0', () => {
        const { getByText } = render(Counter, { props: { page: makePage({ current: 0, target: 10 }) } })
        expect(getByText('0%')).toBeTruthy()
    })

    it('increment button increases current value', async () => {
        const { getByLabelText, getByText } = render(Counter, { props: { page: makePage({ current: 3, target: 10 }) } })
        const incBtn = getByLabelText('Increase')
        await fireEvent.click(incBtn)
        expect(getByText('4')).toBeTruthy()
    })

    it('decrement button decreases current value', async () => {
        const { getByLabelText, getByText } = render(Counter, { props: { page: makePage({ current: 3, target: 10 }) } })
        const decBtn = getByLabelText('Decrease')
        await fireEvent.click(decBtn)
        expect(getByText('2')).toBeTruthy()
    })

    it('decrement cannot go below 0', async () => {
        const { getByLabelText, getByText } = render(Counter, { props: { page: makePage({ current: 0, target: 10 }) } })
        const decBtn = getByLabelText('Decrease')
        await fireEvent.click(decBtn)
        expect(getByText('0')).toBeTruthy()
    })

    it('renders the Counter subtitle', () => {
        const { getByText } = render(Counter, { props: { page: makePage() } })
        expect(getByText('Counter')).toBeTruthy()
    })

    it('renders a Delete button', () => {
        const { getByText } = render(Counter, { props: { page: makePage() } })
        expect(getByText('Delete')).toBeTruthy()
    })
})
