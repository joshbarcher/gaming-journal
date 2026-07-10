import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/svelte'
import Settings from '../../lib/svelte/settings/Settings.svelte'

const mockSettings = {
    showChildLocked: false,
    showFiltered:    false,
    hideUnavailable: false,
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url === '/api/settings') {
            return Promise.resolve({
                ok:   true,
                json: () => Promise.resolve(mockSettings),
            })
        }
        if (url === '/api/flags') {
            return Promise.resolve({
                ok:   true,
                json: () => Promise.resolve({}),
            })
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    }))
    vi.clearAllMocks()
})

describe('Settings component', () => {
    it('shows loading state initially', () => {
        const { getByText } = render(Settings)
        expect(getByText('Loading settings…')).toBeTruthy()
    })

    it('renders settings sections after load', async () => {
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText('Content Filters')).toBeTruthy())
    })

    it('renders the Wishlist section', async () => {
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText('Wishlist')).toBeTruthy())
    })

    it('renders the Hide Child Locked Games toggle', async () => {
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText('Hide Child Locked Games')).toBeTruthy())
    })

    it('renders the Hide Filtered Games toggle', async () => {
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText('Hide Filtered Games')).toBeTruthy())
    })

    it('renders the Hide Software & Tools toggle', async () => {
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText('Hide Software & Tools')).toBeTruthy())
    })

    it('renders the Hide Unavailable Games toggle', async () => {
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText('Hide Unavailable Games')).toBeTruthy())
    })

    it('shows error state when fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
        const { getByText } = render(Settings)
        await waitFor(() => expect(getByText(/Failed to load settings/)).toBeTruthy())
    })
})
