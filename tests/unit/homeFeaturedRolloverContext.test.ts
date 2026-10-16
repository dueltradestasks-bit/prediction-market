import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { Event } from '@/types'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  getSettings: mock(),
  getEventBySlug: mock(),
  getSeriesEventsBySeriesSlug: mock(),
  resolvePublicTargets: mock(),
  loadHomeFeaturedNews: mock(),
}))

void mock.module('next/cache', () => ({ cacheLife: mock(), cacheTag: mock(), revalidateTag: mock() }))
void mock.module('@/lib/db/queries/settings', () => ({ SettingsRepository: { getSettings: mocks.getSettings } }))
void mock.module('@/lib/db/queries/event', () => ({
  EventRepository: {
    getEventBySlug: mocks.getEventBySlug,
    getSeriesEventsBySeriesSlug: mocks.getSeriesEventsBySeriesSlug,
  },
}))
void mock.module('@/lib/db/queries/home-featured-events', () => ({
  HomeFeaturedEventsRepository: { resolvePublicTargets: mocks.resolvePublicTargets },
}))
void mock.module('@/lib/home-featured-news', () => ({ loadHomeFeaturedNews: mocks.loadHomeFeaturedNews }))

const currentEvent = {
  id: 'current',
  slug: 'current-event',
  title: 'Current event',
  series_slug: 'daily-market',
  status: 'active',
  markets: [],
  tags: [],
  end_date: '2099-01-01T00:00:00Z',
} as unknown as Event
const nextEvent = {
  ...currentEvent,
  id: 'next',
  slug: 'next-event',
  title: 'Next event',
  end_date: '2099-01-02T00:00:00Z',
}
const target = {
  featuredId: 'featured',
  targetType: 'series',
  contextMode: 'news',
  eventId: currentEvent.id,
  seriesSlug: currentEvent.series_slug,
}

describe('featured series rollover context', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    mocks.getSettings.mockResolvedValue({
      data: { home_featured: { enabled: { value: 'true', updated_at: '' } } },
      error: null,
    })
    mocks.resolvePublicTargets.mockResolvedValue({ data: [target], error: null })
    mocks.getEventBySlug.mockImplementation(async (slug: string) => ({
      data: slug === currentEvent.slug ? currentEvent : nextEvent,
      error: null,
    }))
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [currentEvent, nextEvent], error: null })
    mocks.loadHomeFeaturedNews.mockImplementation(async (_featuredId: string, event: Event) => [
      { id: `news:${event.id}`, type: 'news', title: `News for ${event.title}` },
    ])
  })

  it('prepares news for the next event and keeps the current event news separate', async () => {
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.currentEventId).toBe(currentEvent.id)
    expect(result?.contextItems[0]?.id).toBe('news:current')
    expect(result?.nextEvent?.event.id).toBe(nextEvent.id)
    expect(result?.nextEvent?.contextItems[0]?.id).toBe('news:next')
  })

  it('refreshes the current event even when a successor is not available yet', async () => {
    mocks.getSeriesEventsBySeriesSlug.mockResolvedValue({ data: [currentEvent], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.nextEvent).toBeNull()
    expect(result?.contextItems[0]?.id).toBe('news:current')
  })

  it('respects hidden context without searching for news', async () => {
    mocks.resolvePublicTargets.mockResolvedValue({ data: [{ ...target, contextMode: 'hidden' }], error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')
    const result = await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')

    expect(result?.contextItems).toEqual([])
    expect(result?.nextEvent?.contextItems).toEqual([])
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })

  it('does not search for an event outside the configured featured series', async () => {
    mocks.getEventBySlug.mockResolvedValue({ data: { ...currentEvent, series_slug: 'other-series' }, error: null })
    const { getNextHomeFeaturedSeriesRolloverEvent } = await import('@/lib/home-featured-events')

    expect(await getNextHomeFeaturedSeriesRolloverEvent(currentEvent.slug, 'featured', 'en')).toBeNull()
    expect(mocks.loadHomeFeaturedNews).not.toHaveBeenCalled()
  })
})
