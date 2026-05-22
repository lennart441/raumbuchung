import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { getApiBaseUrl } from './api-base'

type Me = {
  id: string
  displayName: string
  email: string
  role: 'USER' | 'EXTENDED_USER' | 'ADMIN'
  phone?: string | null
  birthDate?: string | null
  street?: string | null
  houseNumber?: string | null
  postalCode?: string | null
  city?: string | null
}
type Room = { id: string; name: string; description?: string | null }
type BookingSeriesRef = {
  id: string
  recurrence: string
  untilDate: string
  title?: string | null
  description?: string | null
  room?: { name: string }
}

type Booking = {
  id: string
  seriesId?: string | null
  series?: BookingSeriesRef | null
  startAt: string
  endAt: string
  status: string
  isOverbooked: boolean
  title?: string | null
  description?: string | null
  room?: { name: string }
  user?: {
    displayName: string
    email: string
    phone?: string | null
    birthDate?: string | null
    street?: string | null
    houseNumber?: string | null
    postalCode?: string | null
    city?: string | null
  }
}

type CalendarBooking = Booking & { isMasked?: boolean }
type Availability = {
  room: Room
  bookings: Array<{ id: string; startAt: string; endAt: string; status: string; isOverbooked: boolean }>
  blocks: Array<{ id: string; startAt: string; endAt: string }>
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
})

function viteDevFallback(): boolean {
  const v = (import.meta.env.VITE_DEV as string | undefined)?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

type Recurrence = 'DAILY' | 'WEEKLY' | 'MONTHLY'

type SeriesOccurrencePreview = {
  startAt: string
  endAt: string
  conflict: boolean
  reason?: string
}

type Workspace = 'calendar' | 'bookings' | 'approvals'

type SeriesGroup = {
  seriesId: string
  meta: BookingSeriesRef | null | undefined
  bookings: Booking[]
}

function groupBookingsBySeries(bookings: Booking[]): { singles: Booking[]; seriesGroups: SeriesGroup[] } {
  const singles: Booking[] = []
  const bySeries = new Map<string, Booking[]>()
  for (const booking of bookings) {
    if (booking.seriesId) {
      const list = bySeries.get(booking.seriesId) ?? []
      list.push(booking)
      bySeries.set(booking.seriesId, list)
    } else {
      singles.push(booking)
    }
  }
  const seriesGroups = [...bySeries.entries()].map(([seriesId, items]) => ({
    seriesId,
    meta: items[0]?.series ?? null,
    bookings: [...items].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
  }))
  seriesGroups.sort((a, b) => new Date(b.bookings[0]?.startAt ?? 0).getTime() - new Date(a.bookings[0]?.startAt ?? 0).getTime())
  singles.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
  return { singles, seriesGroups }
}

function recurrenceLabel(recurrence: string) {
  if (recurrence === 'DAILY') return 'Taeglich'
  if (recurrence === 'WEEKLY') return 'Woechentlich'
  if (recurrence === 'MONTHLY') return 'Monatlich'
  return recurrence
}

function seriesPendingCount(group: SeriesGroup) {
  return group.bookings.filter((b) => b.status.toUpperCase() === 'PENDING').length
}

function bookingCanApprove(status: string) {
  const s = status.toUpperCase()
  return s === 'PENDING' || s === 'REJECTED'
}

function bookingCanReject(status: string) {
  const s = status.toUpperCase()
  return s === 'PENDING' || s === 'APPROVED'
}

type AdminConfirmAction = {
  scope: 'booking' | 'series'
  action: 'approve' | 'reject'
  bookingId?: string
  seriesId?: string
  statusHint?: string
}

function adminConfirmMessage(action: AdminConfirmAction): string {
  if (action.scope === 'series') {
    return action.action === 'approve'
      ? 'Bist du sicher, dass du die Serie freigeben moechtest? Alle noch nicht freigegebenen Termine werden bestaetigt.'
      : 'Bist du sicher, dass du die Serie ablehnen moechtest? Alle noch nicht abgelehnten Termine werden abgelehnt.'
  }
  const status = action.statusHint?.toUpperCase()
  if (action.action === 'approve' && status === 'REJECTED') {
    return 'Bist du sicher, dass du diesen abgelehnten Termin freigeben moechtest?'
  }
  if (action.action === 'reject' && status === 'APPROVED') {
    return 'Bist du sicher, dass du diesen freigegebenen Termin ablehnen moechtest?'
  }
  return action.action === 'approve'
    ? 'Bist du sicher, dass du diesen Termin freigeben moechtest?'
    : 'Bist du sicher, dass du diesen Termin ablehnen moechtest?'
}

const roleLabels: Record<Me['role'], string> = {
  USER: 'Standardnutzer',
  EXTENDED_USER: 'Erweiterter Nutzer',
  ADMIN: 'Administrator',
}

const DAY_START_HOUR = 0
const DAY_END_HOUR = 24
const TIMELINE_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60
const MOBILE_SLOT_HOURS = 2
const MOBILE_SLOT_MINUTES = MOBILE_SLOT_HOURS * 60
const MOBILE_SLOT_COUNT = TIMELINE_MINUTES / MOBILE_SLOT_MINUTES
const MOBILE_ROW_HEIGHT_PX = 52

function toLocalInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/** `datetime-local` (Ortszeit) → ISO-UTC für die API (Backend läuft oft in UTC). */
function localDateTimeInputToIso(value: string) {
  return new Date(value).toISOString()
}

function dayStartFromInput(input: string) {
  const base = input ? new Date(input) : new Date()
  base.setHours(DAY_START_HOUR, 0, 0, 0)
  return base
}

function pxToMinutes(px: number, width: number) {
  if (width <= 0) return 0
  const clamped = Math.max(0, Math.min(px, width))
  return (clamped / width) * TIMELINE_MINUTES
}

function minutesToDate(base: Date, minutes: number) {
  const result = new Date(base)
  result.setMinutes(result.getMinutes() + minutes)
  return result
}

function bookingClass(status: string) {
  const normalized = status.toUpperCase()
  if (normalized === 'CONFIRMED' || normalized === 'APPROVED') return 'bg-blue-500/90 text-white'
  if (normalized === 'PENDING') return 'bg-amber-400/90 text-slate-900'
  if (normalized === 'BLOCKED' || normalized === 'MAINTENANCE') return 'bg-slate-300 text-slate-700'
  return 'bg-slate-300 text-slate-700'
}

function bookingStatusLabel(status: string) {
  const normalized = status.toUpperCase()
  if (normalized === 'CONFIRMED' || normalized === 'APPROVED') return 'Bestaetigt'
  if (normalized === 'PENDING') return 'Ausstehend'
  if (normalized === 'BLOCKED' || normalized === 'MAINTENANCE') return 'Blockiert'
  if (normalized === 'REJECTED') return 'Abgelehnt'
  return status
}

function displayBookingTitle(booking: Booking | CalendarBooking) {
  const t = booking.title?.trim()
  return t && t.length > 0 ? t : 'Termin'
}

function intervalsOverlap(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date) {
  return aFrom < bTo && aTo > bFrom
}

function bookingMinutesOnDay(booking: { startAt: string; endAt: string }, dayStart: Date) {
  const startMinutes = (new Date(booking.startAt).getTime() - dayStart.getTime()) / 60000
  const endMinutes = (new Date(booking.endAt).getTime() - dayStart.getTime()) / 60000
  return {
    start: Math.max(0, Math.min(startMinutes, TIMELINE_MINUTES)),
    end: Math.max(0, Math.min(endMinutes, TIMELINE_MINUTES)),
  }
}

function bookingOverlapsMinuteRange(
  booking: { startAt: string; endAt: string },
  dayStart: Date,
  rangeStart: number,
  rangeEnd: number,
) {
  const { start, end } = bookingMinutesOnDay(booking, dayStart)
  return start < rangeEnd && end > rangeStart
}

function roomAvailableForTimeFilter(
  roomId: string,
  selectedDay: string,
  filterTimeStart: string,
  filterTimeEnd: string,
  availabilityByRoom: Record<string, Availability> | undefined,
): boolean {
  if (!filterTimeStart || !filterTimeEnd || !availabilityByRoom) return true
  const dayStart = dayStartFromInput(selectedDay)
  const [sh, sm] = filterTimeStart.split(':').map(Number)
  const [eh, em] = filterTimeEnd.split(':').map(Number)
  if (!Number.isFinite(sh) || !Number.isFinite(eh) || !Number.isFinite(sm) || !Number.isFinite(em)) return true
  const slotFrom = new Date(dayStart)
  slotFrom.setHours(sh, sm, 0, 0)
  const slotTo = new Date(dayStart)
  slotTo.setHours(eh, em, 0, 0)
  if (slotTo <= slotFrom) return true
  const dayData = availabilityByRoom[roomId]
  if (!dayData) return true
  for (const b of dayData.bookings ?? []) {
    if (intervalsOverlap(slotFrom, slotTo, new Date(b.startAt), new Date(b.endAt))) return false
  }
  for (const bl of dayData.blocks ?? []) {
    if (intervalsOverlap(slotFrom, slotTo, new Date(bl.startAt), new Date(bl.endAt))) return false
  }
  return true
}

function formatDayLabel(input: string) {
  const date = input ? new Date(input) : new Date()
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatBirthDate(input?: string | null) {
  if (!input) return 'Nicht hinterlegt'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  return date.toLocaleDateString('de-DE')
}

function App() {
  const [authDev, setAuthDev] = useState<boolean | null>(null)
  const [devRolePickerOpen, setDevRolePickerOpen] = useState(false)
  const [isDevLoggedIn, setIsDevLoggedIn] = useState(false)
  const [oidcToken, setOidcToken] = useState<string | null>(null)

  const [devRole, setDevRole] = useState<Me['role']>('USER')
  const [filterTimeStart, setFilterTimeStart] = useState('')
  const [filterTimeEnd, setFilterTimeEnd] = useState('')
  const [selectedDay, setSelectedDay] = useState(toLocalInputValue(dayStartFromInput('')))
  const [selection, setSelection] = useState<{
    roomId: string
    startPx: number
    currentPx: number
    width: number
    active: boolean
  } | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [seriesScopeChoice, setSeriesScopeChoice] = useState<Booking | null>(null)
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirmAction | null>(null)
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [editingSeries, setEditingSeries] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [recurrence, setRecurrence] = useState<Recurrence>('WEEKLY')
  const [recurrenceUntil, setRecurrenceUntil] = useState('')
  const [seriesPreview, setSeriesPreview] = useState<SeriesOccurrencePreview[] | null>(null)
  const [seriesSkippedStarts, setSeriesSkippedStarts] = useState<string[]>([])
  const [seriesPreviewLoading, setSeriesPreviewLoading] = useState(false)
  const [seriesSubmitLoading, setSeriesSubmitLoading] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace>('calendar')
  const [detailsScope, setDetailsScope] = useState<'single' | 'series'>('single')
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)

  const isOidcMode = authDev === false

  useEffect(() => {
    const base = getApiBaseUrl()
    void axios
      .get<{ dev: boolean }>(`${base}/auth/config`)
      .then((res) => setAuthDev(res.data.dev))
      .catch(() => setAuthDev(viteDevFallback()))
  }, [])

  const oidcManager = useMemo(() => {
    if (!isOidcMode) return null
    const authority =
      (import.meta.env.VITE_AUTHENTIK_OIDC_ISSUER as string | undefined) ??
      (import.meta.env.VITE_AUTHENTIK_ISSUER as string | undefined)
    const clientId =
      (import.meta.env.VITE_AUTHENTIK_OIDC_CLIENT_ID as string | undefined) ??
      (import.meta.env.VITE_AUTHENTIK_CLIENT_ID as string | undefined)
    const appOrigin =
      (import.meta.env.VITE_AUTHENTIK_OIDC_APP_ORIGIN as string | undefined) ?? window.location.origin
    if (!authority || !clientId || !appOrigin) return null
    return new UserManager({
      authority,
      client_id: clientId,
      redirect_uri: appOrigin,
      post_logout_redirect_uri:
        (import.meta.env.VITE_AUTHENTIK_OIDC_POST_LOGOUT_REDIRECT_URI as string | undefined) ??
        (import.meta.env.VITE_AUTHENTIK_POST_LOGOUT_REDIRECT_URI as string | undefined) ??
        appOrigin,
      response_type: 'code',
      scope:
        (import.meta.env.VITE_AUTHENTIK_OIDC_SCOPE as string | undefined) ??
        (import.meta.env.VITE_AUTHENTIK_SCOPE as string | undefined) ??
        'openid profile email',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    })
  }, [isOidcMode])

  useEffect(() => {
    if (!isOidcMode || !oidcManager) return
    const search = new URLSearchParams(window.location.search)
    const hasCallbackParams = search.has('code') && search.has('state')
    const bootstrap = async () => {
      try {
        if (hasCallbackParams) {
          await oidcManager.signinRedirectCallback()
          window.history.replaceState({}, document.title, window.location.pathname)
        }
        const user = await oidcManager.getUser()
        setOidcToken(user?.access_token ?? null)
        setAuthError(null)
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'OIDC Anmeldung fehlgeschlagen')
      }
    }
    void bootstrap()
  }, [oidcManager, isOidcMode])

  const isLoggedIn = isOidcMode ? Boolean(oidcToken) : isDevLoggedIn

  const headers = useMemo(() => {
    if (isOidcMode && oidcToken) return { authorization: `Bearer ${oidcToken}` }
    if (!isOidcMode && isLoggedIn) return { 'x-dev-role': devRole }
    return {}
  }, [devRole, isLoggedIn, isOidcMode, oidcToken])

  const me = useQuery({
    queryKey: ['me', headers],
    queryFn: async () => (await api.get<Me>('/auth/me', { headers })).data,
    enabled: isLoggedIn,
  })
  const rooms = useQuery({
    queryKey: ['rooms', headers],
    queryFn: async () => (await api.get<Room[]>('/rooms', { headers })).data,
    enabled: isLoggedIn,
  })
  const bookings = useQuery({
    queryKey: ['bookings-me', headers],
    queryFn: async () => (await api.get<Booking[]>('/bookings/me', { headers })).data,
    enabled: isLoggedIn,
  })
  const adminBookings = useQuery({
    queryKey: ['bookings-admin', headers],
    queryFn: async () => (await api.get<Booking[]>('/admin/bookings', { headers })).data,
    enabled: isLoggedIn && me.data?.role === 'ADMIN',
  })
  const availability = useQuery({
    queryKey: ['availability-day', headers, selectedDay, rooms.data?.map((room) => room.id).join(',')],
    enabled: isLoggedIn && (rooms.data?.length ?? 0) > 0,
    queryFn: async () => {
      const from = dayStartFromInput(selectedDay)
      const to = new Date(from)
      to.setDate(to.getDate() + 1)
      const responses = await Promise.all(
        (rooms.data ?? []).map(async (room) => {
          const res = await api.get<Availability>(`/rooms/${room.id}/availability`, {
            headers,
            params: { from: from.toISOString(), to: to.toISOString() },
          })
          return [room.id, res.data] as const
        }),
      )
      return Object.fromEntries(responses)
    },
  })

  const isAdmin = me.data?.role === 'ADMIN'
  const isExtended = me.data?.role === 'EXTENDED_USER'

  const filteredRooms = useMemo(() => {
    const list = rooms.data ?? []
    return list.filter((room) =>
      roomAvailableForTimeFilter(room.id, selectedDay, filterTimeStart, filterTimeEnd, availability.data),
    )
  }, [rooms.data, selectedDay, filterTimeStart, filterTimeEnd, availability.data])

  const knownBookingsById = useMemo(() => {
    const map = new Map<string, Booking>()
    for (const booking of bookings.data ?? []) map.set(booking.id, booking)
    for (const booking of adminBookings.data ?? []) map.set(booking.id, booking)
    return map
  }, [adminBookings.data, bookings.data])

  const roomCalendar = useMemo(() => {
    return filteredRooms.map((room) => {
      const dayData = availability.data?.[room.id]
      const merged = [
        ...(dayData?.bookings ?? []).map((booking) => {
          const knownBooking = knownBookingsById.get(booking.id)
          const isOwnOrVisible = Boolean(knownBooking) || isAdmin
          return {
            id: booking.id,
            startAt: booking.startAt,
            endAt: booking.endAt,
            status: isOwnOrVisible ? booking.status : 'BLOCKED',
            isOverbooked: booking.isOverbooked,
            room: { name: room.name },
            user: knownBooking?.user,
            title: isOwnOrVisible ? knownBooking?.title ?? undefined : 'Blockiert',
            description: isOwnOrVisible ? knownBooking?.description ?? undefined : undefined,
            isMasked: !isOwnOrVisible,
          }
        }),
        ...(dayData?.blocks ?? []).map((block) => ({
          id: `block-${block.id}`,
          startAt: block.startAt,
          endAt: block.endAt,
          status: 'BLOCKED',
          isOverbooked: false,
          room: { name: room.name },
          title: 'Wartung / Block',
          description: undefined,
        })),
      ]
      return { room, bookings: merged as CalendarBooking[] }
    })
  }, [availability.data, filteredRooms, isAdmin, knownBookingsById])

  const myBookingGroups = useMemo(
    () => groupBookingsBySeries(bookings.data ?? []),
    [bookings.data],
  )

  const pendingBookings = (adminBookings.data ?? []).filter((booking) => booking.status.toUpperCase() === 'PENDING')
  const pendingGroups = useMemo(() => groupBookingsBySeries(pendingBookings), [pendingBookings])
  const pendingSeriesCount = pendingGroups.seriesGroups.length
  const pendingSingleCount = pendingGroups.singles.length

  const activeSeriesBookings = useMemo(() => {
    if (!activeSeriesId) return []
    const mine = (bookings.data ?? []).filter((b) => b.seriesId === activeSeriesId)
    const admin = (adminBookings.data ?? []).filter((b) => b.seriesId === activeSeriesId)
    const map = new Map<string, Booking>()
    for (const b of [...mine, ...admin]) map.set(b.id, b)
    return [...map.values()].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }, [activeSeriesId, adminBookings.data, bookings.data])

  const activeSeriesMeta = useMemo(() => {
    if (!activeSeriesId) return null
    return (
      activeSeriesBookings[0]?.series ??
      pendingGroups.seriesGroups.find((g) => g.seriesId === activeSeriesId)?.meta ??
      myBookingGroups.seriesGroups.find((g) => g.seriesId === activeSeriesId)?.meta ??
      null
    )
  }, [activeSeriesId, activeSeriesBookings, myBookingGroups.seriesGroups, pendingGroups.seriesGroups])

  const selectedBooking = useMemo(() => {
    if (detailsScope === 'series' && activeSeriesId) {
      if (selectedBookingId) {
        const hit = activeSeriesBookings.find((b) => b.id === selectedBookingId)
        if (hit) return hit
      }
      return activeSeriesBookings[0] ?? null
    }
    if (!selectedBookingId) return null
    if (knownBookingsById.has(selectedBookingId)) return knownBookingsById.get(selectedBookingId) ?? null
    for (const row of roomCalendar) {
      const match = row.bookings.find((booking) => booking.id === selectedBookingId)
      if (match) return match
    }
    return null
  }, [activeSeriesBookings, activeSeriesId, detailsScope, knownBookingsById, roomCalendar, selectedBookingId])

  const canEditSeries = useMemo(() => {
    if (!activeSeriesId || detailsScope !== 'series') return false
    if (isAdmin) return true
    return (bookings.data ?? []).some((b) => b.seriesId === activeSeriesId)
  }, [activeSeriesId, bookings.data, detailsScope, isAdmin])

  const canEditSelected = useMemo(() => {
    if (!selectedBooking || selectedBooking.id.startsWith('block-')) return false
    if (isAdmin) return true
    return (bookings.data ?? []).some((booking) => booking.id === selectedBooking.id)
  }, [bookings.data, isAdmin, selectedBooking])

  const selectedSeriesId = selectedBooking?.seriesId ?? null

  const selectedSeriesBookingsList = useMemo(() => {
    if (!selectedSeriesId) return [] as Booking[]
    const seen = new Set<string>()
    const out: Booking[] = []
    for (const booking of [...(adminBookings.data ?? []), ...(bookings.data ?? [])]) {
      if (booking.seriesId !== selectedSeriesId || seen.has(booking.id)) continue
      seen.add(booking.id)
      out.push(booking)
    }
    return out
  }, [selectedSeriesId, adminBookings.data, bookings.data])

  const selectedSeriesPendingCount = useMemo(
    () => selectedSeriesBookingsList.filter((b) => b.status.toUpperCase() === 'PENDING').length,
    [selectedSeriesBookingsList],
  )

  const selectedSeriesCanApprove = useMemo(
    () => selectedSeriesBookingsList.some((b) => bookingCanApprove(b.status)),
    [selectedSeriesBookingsList],
  )

  const selectedSeriesCanReject = useMemo(
    () => selectedSeriesBookingsList.some((b) => bookingCanReject(b.status)),
    [selectedSeriesBookingsList],
  )

  const activeSeriesCanApprove = useMemo(
    () => activeSeriesBookings.some((b) => bookingCanApprove(b.status)),
    [activeSeriesBookings],
  )

  const activeSeriesCanReject = useMemo(
    () => activeSeriesBookings.some((b) => bookingCanReject(b.status)),
    [activeSeriesBookings],
  )

  const canManageSelectedSeries = useMemo(() => {
    if (!selectedSeriesId) return false
    if (isAdmin) return true
    return (bookings.data ?? []).some((b) => b.seriesId === selectedSeriesId)
  }, [selectedSeriesId, isAdmin, bookings.data])

  const refreshAll = async () => {
    await bookings.refetch()
    await availability.refetch()
    if (isAdmin) await adminBookings.refetch()
  }

  const createBooking = async () => {
    if (!roomId || !startAt || !endAt) return
    if (showRecurrence) return
    await api.post(
      '/bookings',
      {
        roomId,
        startAt: localDateTimeInputToIso(startAt),
        endAt: localDateTimeInputToIso(endAt),
        title,
        description,
      },
      { headers },
    )
    await refreshAll()
    setTitle('')
    setDescription('')
    setModalOpen(false)
  }

  const loadSeriesPreview = async () => {
    if (!roomId || !startAt || !endAt || !recurrenceUntil) return
    setSeriesPreviewLoading(true)
    try {
      const res = await api.post<{ occurrences: SeriesOccurrencePreview[] }>(
        '/bookings/series/preview',
        {
          roomId,
          startAt: localDateTimeInputToIso(startAt),
          endAt: localDateTimeInputToIso(endAt),
          recurrence,
          until: recurrenceUntil,
          title: title || undefined,
          description: description || undefined,
        },
        { headers },
      )
      setSeriesPreview(res.data.occurrences)
      setSeriesSkippedStarts([])
    } finally {
      setSeriesPreviewLoading(false)
    }
  }

  const createSeriesBookings = async () => {
    if (!roomId || !startAt || !endAt || !recurrenceUntil) return
    setSeriesSubmitLoading(true)
    try {
      await api.post(
        '/bookings/series',
        {
          roomId,
          startAt: localDateTimeInputToIso(startAt),
          endAt: localDateTimeInputToIso(endAt),
          recurrence,
          until: recurrenceUntil,
          title: title || undefined,
          description: description || undefined,
          skipStartAts: seriesSkippedStarts,
        },
        { headers },
      )
      await refreshAll()
      setTitle('')
      setDescription('')
      setSeriesPreview(null)
      setSeriesSkippedStarts([])
      setShowRecurrence(false)
      setModalOpen(false)
    } finally {
      setSeriesSubmitLoading(false)
    }
  }

  const toggleSeriesSkipRow = (startIso: string) => {
    setSeriesSkippedStarts((prev) =>
      prev.includes(startIso) ? prev.filter((s) => s !== startIso) : [...prev, startIso],
    )
  }

  const saveBookingEdits = async () => {
    if (!selectedBooking || !editingBookingId || !roomId || !startAt || !endAt) return
    await api.patch(
      `/bookings/${editingBookingId}`,
      {
        roomId,
        startAt: localDateTimeInputToIso(startAt),
        endAt: localDateTimeInputToIso(endAt),
        title,
        description,
      },
      { headers },
    )
    await refreshAll()
    setDetailsOpen(false)
    setEditingBookingId(null)
    setEditingSeries(false)
  }

  const deleteBooking = async () => {
    if (!selectedBooking || selectedBooking.id.startsWith('block-')) return
    await api.delete(`/bookings/${selectedBooking.id}`, { headers })
    await refreshAll()
    setDetailsOpen(false)
    setEditingBookingId(null)
    setEditingSeries(false)
    setSelectedBookingId('')
  }

  const requestAdminDecision = (payload: AdminConfirmAction) => {
    setAdminConfirm(payload)
  }

  const executeAdminConfirm = async () => {
    if (!adminConfirm) return
    if (adminConfirm.scope === 'booking' && adminConfirm.bookingId) {
      await api.patch(
        `/admin/bookings/${adminConfirm.bookingId}/${adminConfirm.action}`,
        {},
        { headers },
      )
    } else if (adminConfirm.scope === 'series' && adminConfirm.seriesId) {
      await api.patch(
        `/admin/bookings/series/${adminConfirm.seriesId}/${adminConfirm.action}`,
        {},
        { headers },
      )
    }
    setAdminConfirm(null)
    await refreshAll()
  }

  const saveSeriesEdits = async () => {
    if (!activeSeriesId || !startAt || !endAt) return
    await api.patch(
      `/bookings/series/${activeSeriesId}`,
      {
        roomId: roomId || undefined,
        title,
        description,
        startAt: localDateTimeInputToIso(startAt),
        endAt: localDateTimeInputToIso(endAt),
      },
      { headers },
    )
    await refreshAll()
    setDetailsOpen(false)
    setEditingBookingId(null)
    setEditingSeries(false)
    setActiveSeriesId(null)
    setDetailsScope('single')
  }

  const deleteSeries = async (seriesId?: string) => {
    const id = seriesId ?? activeSeriesId
    if (!id) return
    await api.delete(`/bookings/series/${id}`, { headers })
    await refreshAll()
    setDetailsOpen(false)
    setEditingBookingId(null)
    setActiveSeriesId(null)
    setSelectedBookingId('')
    setDetailsScope('single')
    setEditingSeries(false)
  }

  const openSeriesDetails = (seriesId: string, focusBookingId?: string) => {
    setActiveSeriesId(seriesId)
    setDetailsScope('series')
    setSelectedBookingId(focusBookingId ?? '')
    const sorted =
      [...(bookings.data ?? []), ...(adminBookings.data ?? [])]
        .filter((b) => b.seriesId === seriesId)
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    const sample = sorted[0]
    if (sample) {
      setRoomId(rooms.data?.find((r) => r.name === sample.room?.name)?.id ?? '')
      setTitle(sample.title ?? sample.series?.title ?? '')
      setDescription(sample.description ?? sample.series?.description ?? '')
      setStartAt(toLocalInputValue(new Date(sample.startAt)))
      setEndAt(toLocalInputValue(new Date(sample.endAt)))
    }
    setDetailsOpen(true)
    setEditingBookingId(null)
    setEditingSeries(false)
  }

  const openSingleDetails = (booking: Booking) => {
    setDetailsScope('single')
    setActiveSeriesId(booking.seriesId ?? null)
    setSelectedBookingId(booking.id)
    setRoomId(rooms.data?.find((r) => r.name === booking.room?.name)?.id ?? '')
    setStartAt(toLocalInputValue(new Date(booking.startAt)))
    setEndAt(toLocalInputValue(new Date(booking.endAt)))
    setTitle(booking.title ?? '')
    setDescription(booking.description ?? '')
    setDetailsOpen(true)
    setEditingBookingId(null)
    setEditingSeries(false)
  }

  const populateSingleEditFields = (booking: Booking) => {
    setEditingBookingId(booking.id)
    setRoomId(rooms.data?.find((r) => r.name === booking.room?.name)?.id ?? '')
    setStartAt(toLocalInputValue(new Date(booking.startAt)))
    setEndAt(toLocalInputValue(new Date(booking.endAt)))
    setTitle(booking.title ?? '')
    setDescription(booking.description ?? '')
  }

  const seriesBookingsFor = (seriesId: string) =>
    [...(bookings.data ?? []), ...(adminBookings.data ?? [])]
      .filter((b) => b.seriesId === seriesId)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

  const populateSeriesEditFields = (seriesId?: string) => {
    const sid = seriesId ?? activeSeriesId
    if (!sid) return
    const first = seriesBookingsFor(sid)[0]
    if (!first) return
    setEditingSeries(true)
    setRoomId(rooms.data?.find((r) => r.name === first.room?.name)?.id ?? '')
    setTitle(first.title ?? first.series?.title ?? '')
    setDescription(first.description ?? first.series?.description ?? '')
    setStartAt(toLocalInputValue(new Date(first.startAt)))
    setEndAt(toLocalInputValue(new Date(first.endAt)))
  }

  const startEditBooking = (booking: Booking) => {
    if (!detailsOpen || selectedBookingId !== booking.id) {
      openSingleDetails(booking)
    }
    if (booking.seriesId) {
      setSeriesScopeChoice(booking)
      return
    }
    populateSingleEditFields(booking)
  }

  const startEditSeries = () => {
    if (!activeSeriesId) return
    populateSeriesEditFields(activeSeriesId)
  }

  const openSeriesForEdit = (booking: Booking) => {
    if (!booking.seriesId) return
    openSeriesDetails(booking.seriesId, booking.id)
    populateSeriesEditFields(booking.seriesId)
  }

  const applySeriesScopeChoice = (scope: 'single' | 'series') => {
    const booking = seriesScopeChoice
    if (!booking?.seriesId) return
    setSeriesScopeChoice(null)
    if (scope === 'series') {
      if (!detailsOpen || detailsScope !== 'series' || activeSeriesId !== booking.seriesId) {
        openSeriesDetails(booking.seriesId, booking.id)
      }
      populateSeriesEditFields(booking.seriesId)
    } else {
      if (!detailsOpen || selectedBookingId !== booking.id) {
        openSingleDetails(booking)
      }
      populateSingleEditFields(booking)
    }
  }

  const handleGemeindeLogin = async () => {
    if (isOidcMode) {
      if (!oidcManager) return
      await oidcManager.signinRedirect()
      return
    }
    setDevRolePickerOpen(true)
  }

  const handleDevRoleChoice = (role: Me['role']) => {
    setDevRole(role)
    setIsDevLoggedIn(true)
    setDevRolePickerOpen(false)
  }

  const handleLogout = async () => {
    if (isOidcMode && oidcManager) {
      await oidcManager.removeUser()
      setOidcToken(null)
      await oidcManager.signoutRedirect()
      return
    }
    setDevRolePickerOpen(false)
    setIsDevLoggedIn(false)
  }

  const openModalForSelection = (room: Room, fromPx: number, toPx: number, width: number) => {
    const startMinutes = Math.floor(Math.min(pxToMinutes(fromPx, width), pxToMinutes(toPx, width)) / 15) * 15
    const endMinutes = Math.ceil(Math.max(pxToMinutes(fromPx, width), pxToMinutes(toPx, width)) / 15) * 15
    const dayStart = dayStartFromInput(selectedDay)
    const start = minutesToDate(dayStart, startMinutes)
    const end = minutesToDate(dayStart, Math.max(startMinutes + 30, endMinutes))
    setRoomId(room.id)
    setStartAt(toLocalInputValue(start))
    setEndAt(toLocalInputValue(end))
    setTitle('')
    setDescription('')
    setSeriesPreview(null)
    setSeriesSkippedStarts([])
    setModalOpen(true)
  }

  const openModalForMobileSlot = (room: Room, slotIndex: number) => {
    const startMinutes = slotIndex * MOBILE_SLOT_MINUTES
    const dayStart = dayStartFromInput(selectedDay)
    const start = minutesToDate(dayStart, startMinutes)
    const end = minutesToDate(dayStart, startMinutes + MOBILE_SLOT_MINUTES)
    setRoomId(room.id)
    setStartAt(toLocalInputValue(start))
    setEndAt(toLocalInputValue(end))
    setTitle('')
    setDescription('')
    setSeriesPreview(null)
    setSeriesSkippedStarts([])
    setShowRecurrence(false)
    setModalOpen(true)
  }

  const applyMobileDuration = (hours: number) => {
    if (!startAt) return
    const start = new Date(startAt)
    if (Number.isNaN(start.getTime())) return
    const end = new Date(start)
    end.setHours(end.getHours() + hours)
    setEndAt(toLocalInputValue(end))
  }

  const openDetails = (booking: Booking, room: Room) => {
    const enriched: Booking = { ...booking, room: booking.room ?? { name: room.name } }
    openSingleDetails(enriched)
  }

  const shiftDay = (deltaDays: number) => {
    const base = dayStartFromInput(selectedDay)
    base.setDate(base.getDate() + deltaDays)
    setSelectedDay(toLocalInputValue(base))
  }

  const canStartTimelineSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return false
    if (event.pointerType === 'mouse' && event.button !== 0) return false
    return true
  }

  if (!isLoggedIn) {
    if (authDev === null) {
      return (
        <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-slate-600">Lade Anmeldeoptionen …</div>
        </main>
      )
    }
    return (
      <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 shadow sm:mt-16">
          <h1 className="text-2xl font-semibold">Gemeinde Stocksee</h1>
          <p className="mt-1 text-sm text-slate-600">Raumbuchung</p>
          <p className="mt-2 text-xs text-slate-500">
            {isOidcMode
              ? 'Anmeldung ueber Authentik (OIDC/PKCE).'
              : 'Entwicklungsmodus (DEV=true): keine Authentik-Konfiguration noetig.'}
          </p>
          {isOidcMode && !oidcManager && (
            <p className="mt-2 text-xs text-rose-700">
              OIDC ist aktiv, aber `VITE_AUTHENTIK_OIDC_*` ist unvollstaendig konfiguriert.
            </p>
          )}
          {authError && <p className="mt-2 text-xs text-rose-700">{authError}</p>}
          {!devRolePickerOpen ? (
            <button
              type="button"
              className="mt-5 w-full rounded-lg bg-teal-700 px-3 py-2 font-medium text-white"
              onClick={() => void handleGemeindeLogin()}
            >
              Mit Gemeinde Stocksee Konto anmelden
            </button>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-medium text-slate-800">Als welche Rolle anmelden?</p>
              <p className="text-xs text-slate-500">Nur fuer lokale Entwicklung; es werden feste Dev-Konten verwendet.</p>
              <div className="space-y-2">
                {(['USER', 'EXTENDED_USER', 'ADMIN'] as Me['role'][]).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleDevRoleChoice(role)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {roleLabels[role]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                onClick={() => setDevRolePickerOpen(false)}
              >
                Zurueck
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 p-3 sm:p-5">
      <header className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Gemeinde Stocksee</h1>
            <p className="text-sm text-slate-600">Raumbuchung</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {me.data?.displayName ?? '…'} · <strong>{roleLabels[me.data?.role ?? devRole]}</strong>
            </div>
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              onClick={handleLogout}
              title="Aktuelle Sitzung beenden und zum Login zurueckkehren"
            >
              Abmelden
            </button>
          </div>
        </div>
        <nav className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium ${workspace === 'calendar' ? 'bg-teal-700 text-white' : 'border border-slate-300 text-slate-700'}`}
            onClick={() => setWorkspace('calendar')}
          >
            Kalender
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium ${workspace === 'bookings' ? 'bg-teal-700 text-white' : 'border border-slate-300 text-slate-700'}`}
            onClick={() => setWorkspace('bookings')}
          >
            Meine Buchungen
          </button>
          {isAdmin && (
            <button
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-medium ${workspace === 'approvals' ? 'bg-teal-700 text-white' : 'border border-slate-300 text-slate-700'}`}
              onClick={() => setWorkspace('approvals')}
            >
              Freigaben ({pendingSeriesCount + pendingSingleCount})
            </button>
          )}
        </nav>
      </header>

      <details className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <summary className="cursor-pointer select-none text-lg font-semibold">Mein Profil (readonly)</summary>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <strong>Name:</strong> {me.data?.displayName ?? '-'}
          </div>
          <div>
            <strong>E-Mail:</strong> {me.data?.email ?? '-'}
          </div>
          <div>
            <strong>Telefon:</strong> {me.data?.phone ?? 'Nicht hinterlegt'}
          </div>
          <div>
            <strong>Strasse:</strong> {me.data?.street ?? 'Nicht hinterlegt'}
          </div>
          <div>
            <strong>Hausnummer:</strong> {me.data?.houseNumber ?? 'Nicht hinterlegt'}
          </div>
          <div>
            <strong>PLZ / Stadt:</strong> {me.data?.postalCode ?? '-'} {me.data?.city ?? ''}
          </div>
          <div>
            <strong>Geburtsdatum:</strong> {formatBirthDate(me.data?.birthDate)}
          </div>
        </div>
      </details>

      {workspace === 'bookings' && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Meine Buchungen</h2>
            <button
              type="button"
              className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white"
              onClick={() => {
                setWorkspace('calendar')
                setEditingBookingId(null)
                setModalOpen(true)
              }}
            >
              Neue Buchung
            </button>
          </div>
          {myBookingGroups.seriesGroups.length > 0 && (
            <div className="mb-6 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Serienbuchungen</h3>
              {myBookingGroups.seriesGroups.map((group) => (
                <article key={group.seriesId} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{group.meta?.title?.trim() || 'Serienbuchung'}</div>
                      <div className="text-xs text-slate-600">
                        {group.bookings[0]?.room?.name ?? group.meta?.room?.name ?? 'Raum'} ·{' '}
                        {recurrenceLabel(group.meta?.recurrence ?? 'WEEKLY')} · {group.bookings.length} Termine
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-teal-700 px-2 py-1 text-xs text-teal-800"
                      onClick={() => openSeriesDetails(group.seriesId)}
                    >
                      Serie verwalten
                    </button>
                  </div>
                  <div className="mt-2 max-h-40 overflow-y-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          <th className="p-2">Beginn</th>
                          <th className="p-2">Status</th>
                          <th className="p-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.bookings.map((booking) => (
                          <tr key={booking.id} className="border-t border-slate-100">
                            <td className="p-2">{new Date(booking.startAt).toLocaleString('de-DE')}</td>
                            <td className="p-2">
                              <span className={`rounded-full px-2 py-0.5 ${bookingClass(booking.status)}`}>
                                {bookingStatusLabel(booking.status)}
                              </span>
                            </td>
                            <td className="p-2 text-right">
                              <button
                                type="button"
                                className="text-teal-800 underline"
                                onClick={() => openSingleDetails(booking)}
                              >
                                Termin
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Einzelbuchungen</h3>
            {myBookingGroups.singles.length === 0 ? (
              <p className="text-sm text-slate-500">Keine Einzelbuchungen.</p>
            ) : (
              <ul className="space-y-2">
                {myBookingGroups.singles.map((booking) => (
                  <li key={booking.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <button type="button" className="w-full text-left" onClick={() => openSingleDetails(booking)}>
                      <div className="font-medium">{displayBookingTitle(booking)}</div>
                      <div className="text-slate-600">
                        {booking.room?.name} · {new Date(booking.startAt).toLocaleString('de-DE')}
                      </div>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${bookingClass(booking.status)}`}>
                        {bookingStatusLabel(booking.status)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {workspace === 'approvals' && isAdmin && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Freigaben</h2>
          {pendingBookings.length === 0 ? (
            <p className="text-sm text-slate-500">Keine offenen Anfragen.</p>
          ) : (
            <div className="space-y-4">
              {pendingGroups.seriesGroups.map((group) => (
                <article key={group.seriesId} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {group.bookings[0]?.user?.displayName} · {group.bookings[0]?.room?.name}
                      </div>
                      <div className="text-sm text-slate-600">
                        Serienbuchung · {recurrenceLabel(group.meta?.recurrence ?? 'WEEKLY')} ·{' '}
                        {seriesPendingCount(group)} ausstehend / {group.bookings.length} Termine
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded bg-teal-700 px-2 py-1 text-xs text-white"
                        onClick={() =>
                          requestAdminDecision({
                            scope: 'series',
                            action: 'approve',
                            seriesId: group.seriesId,
                          })
                        }
                      >
                        Serie freigeben
                      </button>
                      <button
                        type="button"
                        className="rounded bg-rose-600 px-2 py-1 text-xs text-white"
                        onClick={() =>
                          requestAdminDecision({
                            scope: 'series',
                            action: 'reject',
                            seriesId: group.seriesId,
                          })
                        }
                      >
                        Serie ablehnen
                      </button>
                      <button
                        type="button"
                        className="rounded border border-teal-700 px-2 py-1 text-xs text-teal-800"
                        onClick={() => openSeriesDetails(group.seriesId)}
                      >
                        Serie bearbeiten
                      </button>
                    </div>
                  </div>
                  <table className="mt-3 w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-white text-left">
                        <th className="p-2">Beginn</th>
                        <th className="p-2">Ende</th>
                        <th className="p-2">Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.bookings.map((booking) => (
                        <tr key={booking.id} className="border-t border-amber-100">
                          <td className="p-2">{new Date(booking.startAt).toLocaleString('de-DE')}</td>
                          <td className="p-2">{new Date(booking.endAt).toLocaleString('de-DE')}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                className="rounded bg-teal-700 px-2 py-0.5 text-white"
                                onClick={() =>
                                  requestAdminDecision({
                                    scope: 'booking',
                                    action: 'approve',
                                    bookingId: booking.id,
                                    statusHint: booking.status,
                                  })
                                }
                              >
                                Freigeben
                              </button>
                              <button
                                type="button"
                                className="rounded bg-rose-600 px-2 py-0.5 text-white"
                                onClick={() =>
                                  requestAdminDecision({
                                    scope: 'booking',
                                    action: 'reject',
                                    bookingId: booking.id,
                                    statusHint: booking.status,
                                  })
                                }
                              >
                                Ablehnen
                              </button>
                              <button
                                type="button"
                                className="rounded border border-slate-300 px-2 py-0.5"
                                onClick={() => startEditBooking(booking)}
                              >
                                Bearbeiten
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              ))}
              {pendingGroups.singles.map((booking) => (
                <article key={booking.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="font-medium">
                    {booking.user?.displayName} · {booking.room?.name}
                  </div>
                  <div className="mb-2 text-sm">{new Date(booking.startAt).toLocaleString('de-DE')}</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-teal-700 px-2 py-1 text-xs text-white"
                      onClick={() =>
                        requestAdminDecision({
                          scope: 'booking',
                          action: 'approve',
                          bookingId: booking.id,
                          statusHint: booking.status,
                        })
                      }
                    >
                      Freigeben
                    </button>
                    <button
                      type="button"
                      className="rounded bg-rose-600 px-2 py-1 text-xs text-white"
                      onClick={() =>
                        requestAdminDecision({
                          scope: 'booking',
                          action: 'reject',
                          bookingId: booking.id,
                          statusHint: booking.status,
                        })
                      }
                    >
                      Ablehnen
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() => startEditBooking(booking)}
                    >
                      Bearbeiten
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {workspace === 'calendar' && (
      <div className="grid gap-4 2xl:grid-cols-[280px_1fr_280px]">
        {/* Mobile/Tablet: Filter als Akkordeon */}
        <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 2xl:hidden">
          <summary className="cursor-pointer select-none text-lg font-semibold">Filter</summary>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Tag</label>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 p-2"
                value={selectedDay.slice(0, 10)}
                onChange={(e) => setSelectedDay(`${e.target.value}T00:00`)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Verfuegbarkeit (Uhrzeit)</label>
              <p className="mb-2 text-xs text-slate-500">Nur Räume anzeigen, die am gewählten Tag im Zeitraum frei sind. Leer lassen für alle Räume.</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  <span className="mb-1 block">Von</span>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-slate-300 p-2"
                    value={filterTimeStart}
                    onChange={(e) => setFilterTimeStart(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block">Bis</span>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-slate-300 p-2"
                    value={filterTimeEnd}
                    onChange={(e) => setFilterTimeEnd(e.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>
        </details>

        {/* Desktop/Wideboard: Filter links fix */}
        <aside className="hidden space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 2xl:block">
          <h2 className="text-lg font-semibold">Raum-Filter</h2>
          <div>
            <label className="mb-1 block text-sm font-medium">Tag</label>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-300 p-2"
              value={selectedDay.slice(0, 10)}
              onChange={(e) => setSelectedDay(`${e.target.value}T00:00`)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Verfuegbarkeit (Uhrzeit)</label>
            <p className="mb-2 text-xs text-slate-500">Leer lassen, um alle Räume anzuzeigen.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="mb-1 block">Von</span>
                <input
                  type="time"
                  className="w-full rounded-lg border border-slate-300 p-2"
                  value={filterTimeStart}
                  onChange={(e) => setFilterTimeStart(e.target.value)}
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block">Bis</span>
                <input
                  type="time"
                  className="w-full rounded-lg border border-slate-300 p-2"
                  value={filterTimeEnd}
                  onChange={(e) => setFilterTimeEnd(e.target.value)}
                />
              </label>
            </div>
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Timeline (00:00 - 24:00)</h2>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                <button className="rounded-md border border-slate-300 px-2 py-1" onClick={() => shiftDay(-1)} title="Einen Tag zurueck">
                  ←
                </button>
                <span className="min-w-52 text-center font-medium">{formatDayLabel(selectedDay)}</span>
                <button className="rounded-md border border-slate-300 px-2 py-1" onClick={() => shiftDay(1)} title="Einen Tag vor">
                  →
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">Bestaetigt</span>
              <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Ausstehend</span>
              <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-700">Blockiert</span>
            </div>
          </div>

          {/* Mobile: vertikale Zeitleiste, Räume als Spalten, Tippen statt Ziehen */}
          <div className="md:hidden">
            <div
              className="mb-2 grid gap-1"
              style={{ gridTemplateColumns: `2.75rem repeat(${Math.max(roomCalendar.length, 1)}, minmax(0, 1fr))` }}
            >
              <div />
              {roomCalendar.map(({ room }) => (
                <div key={room.id} className="rounded-lg border border-slate-200 px-1.5 py-1.5 text-center text-[10px] font-semibold leading-tight">
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="line-clamp-2">{room.name}</span>
                    {room.description && (
                      <span
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-700"
                        title={room.description}
                      >
                        i
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="max-h-[min(70vh,640px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200">
              <div
                className="grid gap-0"
                style={{ gridTemplateColumns: `2.75rem repeat(${Math.max(roomCalendar.length, 1)}, minmax(0, 1fr))` }}
              >
                <div className="bg-slate-50/80">
                  {Array.from({ length: MOBILE_SLOT_COUNT }).map((_, slotIdx) => (
                    <div
                      key={slotIdx}
                      className="flex items-start border-b border-slate-200/80 px-1 pt-1 text-[10px] text-slate-500"
                      style={{ height: MOBILE_ROW_HEIGHT_PX }}
                    >
                      {String(DAY_START_HOUR + slotIdx * MOBILE_SLOT_HOURS).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {roomCalendar.map(({ room, bookings: roomBookings }) => {
                  const dayStart = dayStartFromInput(selectedDay)
                  const trackHeight = MOBILE_SLOT_COUNT * MOBILE_ROW_HEIGHT_PX
                  return (
                    <div
                      key={room.id}
                      className="relative border-l border-slate-200 bg-slate-50"
                      style={{ height: trackHeight }}
                    >
                      {Array.from({ length: MOBILE_SLOT_COUNT }).map((_, slotIdx) => {
                        const rangeStart = slotIdx * MOBILE_SLOT_MINUTES
                        const rangeEnd = rangeStart + MOBILE_SLOT_MINUTES
                        const occupied = roomBookings.some((booking) =>
                          bookingOverlapsMinuteRange(booking, dayStart, rangeStart, rangeEnd),
                        )
                        if (occupied) return null
                        return (
                          <button
                            key={slotIdx}
                            type="button"
                            className="absolute inset-x-0 z-0 border-b border-slate-200/70 active:bg-teal-100/60"
                            style={{
                              top: `${(rangeStart / TIMELINE_MINUTES) * 100}%`,
                              height: `${(MOBILE_SLOT_MINUTES / TIMELINE_MINUTES) * 100}%`,
                            }}
                            onClick={() => openModalForMobileSlot(room, slotIdx)}
                            title={`${room.name}: ${String(DAY_START_HOUR + slotIdx * MOBILE_SLOT_HOURS).padStart(2, '0')}:00 buchen`}
                            aria-label={`Freier Slot ${room.name} ab ${String(DAY_START_HOUR + slotIdx * MOBILE_SLOT_HOURS).padStart(2, '0')}:00`}
                          />
                        )
                      })}
                      {roomBookings.map((booking) => {
                        const { start, end } = bookingMinutesOnDay(booking, dayStart)
                        const top = `${(start / TIMELINE_MINUTES) * 100}%`
                        const height = `${Math.max(2, ((end - start) / TIMELINE_MINUTES) * 100)}%`
                        const canSeePerson = isAdmin || !booking.isMasked
                        const isClickable = !booking.isMasked
                        return (
                          <div
                            key={booking.id}
                            className={`absolute inset-x-0.5 z-10 overflow-hidden rounded-md px-1 py-0.5 text-[9px] leading-tight shadow-sm ${bookingClass(booking.status)} ${
                              isClickable ? '' : 'pointer-events-none'
                            }`}
                            style={{ top, height }}
                            title={
                              booking.isMasked
                                ? 'Blockiert'
                                : `Details: ${displayBookingTitle(booking)}${
                                    booking.seriesId ? ' · Serienbuchung' : ''
                                  }${
                                    canSeePerson && booking.user?.displayName ? ` (${booking.user.displayName})` : ''
                                  }`
                            }
                          >
                            {isClickable ? (
                              <button
                                type="button"
                                className="h-full w-full text-left"
                                onClick={() => openDetails(booking, room)}
                              >
                                <span className="block truncate font-medium">
                                  {booking.seriesId ? (
                                    <span className="mr-0.5 font-semibold opacity-80">Serie ·</span>
                                  ) : null}
                                  {displayBookingTitle(booking)}
                                </span>
                                {canSeePerson && booking.user?.displayName && (
                                  <span className="block truncate opacity-90">{booking.user.displayName}</span>
                                )}
                              </button>
                            ) : (
                              <span className="block truncate font-medium">Blockiert</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Tippen Sie auf einen freien Zeitslot, um eine Buchung zu starten.</p>
          </div>

          {/* Desktop: horizontale Timeline mit Drag-Auswahl */}
          <div className="hidden max-w-full overflow-x-auto touch-pan-x md:block">
            <div className="min-w-[760px]">
              <div className="mb-2 grid grid-cols-[132px_1fr] sm:grid-cols-[156px_1fr]">
                <div className="sticky left-0 z-20 bg-white pr-2">
                  <div className="h-5" />
                </div>
                <div className="grid grid-cols-12 text-xs text-slate-500">
                  {Array.from({ length: 13 }).map((_, idx) => (
                    <div key={idx}>{String(DAY_START_HOUR + idx * 2).padStart(2, '0')}:00</div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {roomCalendar.map(({ room, bookings: roomBookings }) => (
                  <div key={room.id} className="grid grid-cols-[132px_1fr] gap-2 sm:grid-cols-[156px_1fr] sm:gap-3">
                    <div className="sticky left-0 z-20 bg-white pr-2">
                      <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">{room.name}</div>
                          {room.description && (
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700"
                              title={room.description}
                            >
                              i
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="relative h-14 rounded-xl border border-slate-200 bg-slate-50"
                      onPointerDown={(e) => {
                        const target = e.target as HTMLElement
                        if (target.closest('button')) return
                        if (!canStartTimelineSelection(e)) return
                        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const startPxPos = e.clientX - rect.left
                        setSelection({ roomId: room.id, startPx: startPxPos, currentPx: startPxPos, width: rect.width, active: true })
                      }}
                      onPointerMove={(e) => {
                        if (!selection?.active || selection.roomId !== room.id) return
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setSelection((prev) => (prev ? { ...prev, currentPx: e.clientX - rect.left, width: rect.width } : prev))
                      }}
                      onPointerUp={(e) => {
                        if (!selection || selection.roomId !== room.id) return
                        try {
                          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                        } catch {
                          // ignore
                        }
                        openModalForSelection(room, selection.startPx, selection.currentPx, selection.width)
                        setSelection(null)
                      }}
                      onPointerCancel={() => {
                        if (!selection?.active || selection.roomId !== room.id) return
                        setSelection(null)
                      }}
                    >
                      <div className="absolute inset-0 grid grid-cols-24">
                        {Array.from({ length: 23 }).map((_, idx) => (
                          <div key={idx} className="border-r border-slate-200/70" />
                        ))}
                      </div>
                      {roomBookings.map((booking) => {
                        const dayStart = dayStartFromInput(selectedDay)
                        const { start: clampedStart, end: clampedEnd } = bookingMinutesOnDay(booking, dayStart)
                        const left = `${(clampedStart / TIMELINE_MINUTES) * 100}%`
                        const width = `${Math.max(4, ((clampedEnd - clampedStart) / TIMELINE_MINUTES) * 100)}%`
                        const canSeePerson = isAdmin || !booking.isMasked
                        return (
                          <button
                            key={booking.id}
                            className={`absolute top-2 h-10 rounded-xl px-2 text-xs shadow-sm ${bookingClass(booking.status)}`}
                            style={{ left, width }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              openDetails(booking, room)
                            }}
                            title={
                              booking.isMasked
                                ? 'Blockiert'
                                : `Details anzeigen: ${displayBookingTitle(booking)}${
                                    booking.seriesId ? ' · Serienbuchung' : ''
                                  }${
                                    canSeePerson && booking.user?.displayName ? ` (${booking.user.displayName})` : ''
                                  }`
                            }
                          >
                            <span className="block truncate text-left leading-tight">
                              {booking.isMasked ? (
                                'Blockiert'
                              ) : (
                                <>
                                  {booking.seriesId ? (
                                    <span className="mr-0.5 font-semibold opacity-80">Serie ·</span>
                                  ) : null}
                                  {displayBookingTitle(booking)}
                                </>
                              )}
                            </span>
                            {canSeePerson && booking.user?.displayName && (
                              <span className="block truncate text-left text-[10px] opacity-90">{booking.user.displayName}</span>
                            )}
                          </button>
                        )
                      })}
                      {selection?.roomId === room.id && (
                        <div
                          className="absolute top-2 h-10 rounded-xl bg-teal-600/25 ring-1 ring-teal-700"
                          style={{
                            left: `${Math.min(selection.startPx, selection.currentPx)}px`,
                            width: `${Math.abs(selection.currentPx - selection.startPx)}px`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 2xl:hidden">
          <summary className="cursor-pointer select-none text-lg font-semibold">Schnell-Buchung</summary>
          <button
            className="mt-4 w-full rounded-lg bg-teal-700 px-3 py-2 font-medium text-white"
            onClick={() => {
              setEditingBookingId(null)
              setTitle('')
              setDescription('')
              setSeriesPreview(null)
              setSeriesSkippedStarts([])
              setShowRecurrence(false)
              setModalOpen(true)
            }}
          >
            {isExtended ? 'Direkt buchen' : 'Buchung anfragen'}
          </button>
        </details>

        <aside className="hidden space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 2xl:block">
          <h2 className="text-lg font-semibold">Schnell-Buchung</h2>
          <button
            className="w-full rounded-lg bg-teal-700 px-3 py-2 font-medium text-white"
            onClick={() => {
              setEditingBookingId(null)
              setTitle('')
              setDescription('')
              setSeriesPreview(null)
              setSeriesSkippedStarts([])
              setShowRecurrence(false)
              setModalOpen(true)
            }}
          >
            {isExtended ? 'Direkt buchen' : 'Buchung anfragen'}
          </button>
          <p className="text-xs text-slate-500">
            Buchungen und Freigaben finden Sie in den Reitern oben.
          </p>
        </aside>
      </div>
      )}

      {seriesScopeChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" role="dialog" aria-labelledby="series-scope-title">
            <h3 id="series-scope-title" className="text-lg font-semibold">
              Serientermin bearbeiten
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Dieser Termin gehoert zu einer Serienbuchung. Moechten Sie nur diesen Termin oder die gesamte Serie
              bearbeiten?
            </p>
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <span className="font-medium">{displayBookingTitle(seriesScopeChoice)}</span>
              <br />
              {seriesScopeChoice.room?.name ?? 'Raum'} ·{' '}
              {new Date(seriesScopeChoice.startAt).toLocaleString('de-DE')}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setSeriesScopeChoice(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="rounded border border-teal-700 px-3 py-2 text-sm text-teal-800"
                onClick={() => applySeriesScopeChoice('single')}
              >
                Einzelnen Termin
              </button>
              <button
                type="button"
                className="rounded bg-teal-700 px-3 py-2 text-sm font-medium text-white"
                onClick={() => applySeriesScopeChoice('series')}
              >
                Serie bearbeiten
              </button>
            </div>
          </div>
        </div>
      )}

      {adminConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            role="alertdialog"
            aria-labelledby="admin-confirm-title"
            aria-describedby="admin-confirm-desc"
          >
            <h3 id="admin-confirm-title" className="text-lg font-semibold">
              Bestaetigung
            </h3>
            <p id="admin-confirm-desc" className="mt-2 text-sm text-slate-600">
              {adminConfirmMessage(adminConfirm)}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                onClick={() => setAdminConfirm(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className={
                  adminConfirm.action === 'approve'
                    ? 'rounded bg-teal-700 px-3 py-2 text-sm font-medium text-white'
                    : 'rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white'
                }
                onClick={() => void executeAdminConfirm()}
              >
                {adminConfirm.action === 'approve' ? 'Freigeben' : 'Ablehnen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Buchung anfragen</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Raum</span>
                <select className="w-full rounded border p-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  <option value="">Raum waehlen</option>
                  {(rooms.data ?? []).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Start (erster Termin)</span>
                <input className="w-full rounded border p-2" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Ende (erster Termin)</span>
                <input className="w-full rounded border p-2" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </label>
              <label className="text-sm md:hidden">
                <span className="mb-1 block text-slate-700">Dauer (Schnellauswahl)</span>
                <select
                  className="w-full rounded border p-2"
                  defaultValue={MOBILE_SLOT_HOURS}
                  onChange={(e) => applyMobileDuration(Number(e.target.value))}
                >
                  <option value="1">1 Stunde</option>
                  <option value="2">2 Stunden</option>
                  <option value="3">3 Stunden</option>
                  <option value="4">4 Stunden</option>
                  <option value="6">6 Stunden</option>
                  <option value="8">8 Stunden</option>
                </select>
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-700">Titel</span>
                <input className="w-full rounded border p-2" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-700">Terminbeschreibung</span>
                <textarea
                  className="min-h-24 w-full rounded border p-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showRecurrence}
                onChange={(e) => {
                  const on = e.target.checked
                  setShowRecurrence(on)
                  if (!on) {
                    setSeriesPreview(null)
                    setSeriesSkippedStarts([])
                  }
                }}
              />
              Serienbuchung aktivieren
            </label>
            {showRecurrence && (
              <div className="mt-2 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="text-xs md:col-span-2">
                    <span className="mb-1 block text-sm text-slate-700">Wiederholung</span>
                    <select className="w-full rounded border p-2" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                      <option value="DAILY">Taeglich</option>
                      <option value="WEEKLY">Woechentlich</option>
                      <option value="MONTHLY">Monatlich</option>
                    </select>
                  </label>
                  <label className="text-xs md:col-span-2">
                    <span className="mb-1 block text-sm text-slate-700">Serie bis (Datum inklusive)</span>
                    <input className="w-full rounded border p-2" type="date" value={recurrenceUntil} onChange={(e) => setRecurrenceUntil(e.target.value)} />
                  </label>
                </div>
                <button
                  type="button"
                  className="w-full rounded border border-teal-700 px-3 py-2 text-sm text-teal-800"
                  disabled={seriesPreviewLoading || !roomId || !startAt || !endAt || !recurrenceUntil}
                  onClick={() => void loadSeriesPreview()}
                >
                  {seriesPreviewLoading ? 'Vorschau laedt...' : 'Vorschau laden'}
                </button>
                {seriesPreview && seriesPreview.length > 0 && (
                  <div className="rounded-lg border border-slate-200">
                    <div className="max-h-52 overflow-y-auto text-xs">
                      <table className="w-full border-collapse text-left">
                        <thead className="sticky top-0 bg-slate-100">
                          <tr>
                            <th className="border-b p-2">Beginn</th>
                            <th className="border-b p-2">Konflikt</th>
                            <th className="border-b p-2">Auslassen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {seriesPreview.map((row) => {
                            const checked = seriesSkippedStarts.includes(row.startAt)
                            return (
                              <tr key={row.startAt} className={row.conflict ? 'bg-rose-50' : ''}>
                                <td className="border-b p-2">{new Date(row.startAt).toLocaleString('de-DE')}</td>
                                <td className="border-b p-2">
                                  {row.conflict ? (
                                    <span title={row.reason ?? ''}>Ja</span>
                                  ) : (
                                    'Nein'
                                  )}
                                </td>
                                <td className="border-b p-2 text-center">
                                  {row.conflict ? (
                                    <span className="text-slate-500" title="Wird nicht gebucht">
                                      —
                                    </span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      title="Diesen freien Termin auslassen"
                                      onChange={() => toggleSeriesSkipRow(row.startAt)}
                                    />
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="border-t p-2 text-xs text-slate-600">
                      Konflikttermine werden nicht gebucht. Freie Termine koennen Sie optional per Checkbox auslassen.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="rounded border px-3 py-2" onClick={() => setModalOpen(false)}>
                Abbrechen
              </button>
              {showRecurrence ? (
                <button
                  type="button"
                  className="rounded bg-teal-700 px-3 py-2 text-white disabled:opacity-50"
                  disabled={seriesSubmitLoading || !seriesPreview}
                  onClick={() => void createSeriesBookings()}
                >
                  {seriesSubmitLoading ? 'Speichern...' : isExtended ? 'Serie direkt buchen' : 'Serie anfragen'}
                </button>
              ) : (
                <button type="button" className="rounded bg-teal-700 px-3 py-2 text-white" onClick={() => void createBooking()}>
                  {isExtended ? 'Direkt buchen' : 'Anfrage senden'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {detailsOpen && (selectedBooking || (detailsScope === 'series' && activeSeriesId)) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">
                {detailsScope === 'series' ? 'Serienbuchung' : 'Buchungsdetails'}
              </h3>
              {activeSeriesId && detailsScope === 'single' && selectedBooking?.seriesId && (
                <button
                  type="button"
                  className="text-sm text-teal-800 underline"
                  onClick={() => openSeriesDetails(activeSeriesId, selectedBooking.id)}
                >
                  Zur Serie wechseln
                </button>
              )}
              {activeSeriesId && detailsScope === 'series' && selectedBooking && (
                <button
                  type="button"
                  className="text-sm text-teal-800 underline"
                  onClick={() => openSingleDetails(selectedBooking)}
                >
                  Einzelnen Termin anzeigen
                </button>
              )}
            </div>

            {detailsScope === 'series' && activeSeriesId ? (
              <>
                <div className="mt-3 space-y-2 text-sm">
                  <div>
                    <strong>Titel:</strong> {activeSeriesMeta?.title?.trim() || title || 'Serienbuchung'}
                  </div>
                  <div>
                    <strong>Raum:</strong> {activeSeriesBookings[0]?.room?.name ?? activeSeriesMeta?.room?.name ?? 'Raum'}
                  </div>
                  <div>
                    <strong>Wiederholung:</strong> {recurrenceLabel(activeSeriesMeta?.recurrence ?? 'WEEKLY')}
                  </div>
                  <div>
                    <strong>Termine:</strong> {activeSeriesBookings.length}
                  </div>
                  {isAdmin && selectedBooking?.user && (
                    <div>
                      <strong>Person:</strong> {selectedBooking.user.displayName} ({selectedBooking.user.email})
                    </div>
                  )}
                </div>
                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100">
                      <tr>
                        <th className="p-2 text-left">Beginn</th>
                        <th className="p-2 text-left">Ende</th>
                        <th className="p-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSeriesBookings.map((booking) => (
                        <tr
                          key={booking.id}
                          className={`border-t border-slate-100 ${selectedBookingId === booking.id ? 'bg-teal-50' : ''}`}
                        >
                          <td className="p-2">{new Date(booking.startAt).toLocaleString('de-DE')}</td>
                          <td className="p-2">{new Date(booking.endAt).toLocaleString('de-DE')}</td>
                          <td className="p-2">{bookingStatusLabel(booking.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEditSeries && editingSeries && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-medium">Serie bearbeiten</p>
                    <p className="mb-3 text-xs text-slate-600">
                      Start und Ende beziehen sich auf den ersten Termin; alle Termine werden gemeinsam verschoben.
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <select className="rounded border p-2 text-sm md:col-span-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                        <option value="">Raum waehlen</option>
                        {(rooms.data ?? []).map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-700">Start (erster Termin)</span>
                        <input
                          className="w-full rounded border p-2 text-sm"
                          type="datetime-local"
                          value={startAt}
                          onChange={(e) => setStartAt(e.target.value)}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-700">Ende (erster Termin)</span>
                        <input
                          className="w-full rounded border p-2 text-sm"
                          type="datetime-local"
                          value={endAt}
                          onChange={(e) => setEndAt(e.target.value)}
                        />
                      </label>
                      <input
                        className="rounded border p-2 text-sm md:col-span-2"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Titel (alle Termine)"
                      />
                      <textarea
                        className="min-h-20 rounded border p-2 text-sm md:col-span-2"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Beschreibung (alle Termine)"
                        rows={3}
                      />
                      <div className="flex flex-wrap gap-2 md:col-span-2">
                        <button type="button" className="rounded bg-teal-700 px-3 py-2 text-sm text-white" onClick={() => void saveSeriesEdits()}>
                          Serie speichern
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-3 py-2 text-sm"
                          onClick={() => setEditingSeries(false)}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {!editingSeries && canEditSeries && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Serie</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <button
                        type="button"
                        className="rounded border border-teal-700 bg-white px-3 py-2 text-sm text-teal-800"
                        onClick={() => startEditSeries()}
                      >
                        Bearbeiten
                      </button>
                      {isAdmin && activeSeriesCanApprove && (
                        <button
                          type="button"
                          className="rounded bg-teal-700 px-3 py-2 text-sm text-white"
                          onClick={() =>
                            requestAdminDecision({
                              scope: 'series',
                              action: 'approve',
                              seriesId: activeSeriesId,
                            })
                          }
                        >
                          Freigeben
                        </button>
                      )}
                      {isAdmin && activeSeriesCanReject && (
                        <button
                          type="button"
                          className="rounded bg-rose-600 px-3 py-2 text-sm text-white"
                          onClick={() =>
                            requestAdminDecision({
                              scope: 'series',
                              action: 'reject',
                              seriesId: activeSeriesId,
                            })
                          }
                        >
                          Ablehnen
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700"
                        onClick={() => void deleteSeries()}
                      >
                        Loeschen
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-4 py-2 text-sm"
                    onClick={() => {
                      setDetailsOpen(false)
                      setDetailsScope('single')
                      setActiveSeriesId(null)
                      setEditingSeries(false)
                      setEditingBookingId(null)
                    }}
                  >
                    Schliessen
                  </button>
                </div>
              </>
            ) : selectedBooking ? (
              <>
                <div className="mt-3 space-y-2 text-sm">
                  <div>
                    <strong>Titel:</strong> {displayBookingTitle(selectedBooking)}
                  </div>
                  {selectedBooking.description?.trim() ? (
                    <div>
                      <strong>Beschreibung:</strong>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-2 text-slate-800">
                        {selectedBooking.description}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <strong>Status:</strong> {bookingStatusLabel(selectedBooking.status)}
                  </div>
                  <div>
                    <strong>Raum:</strong> {selectedBooking.room?.name ?? 'Raum'}
                  </div>
                  <div>
                    <strong>Start:</strong> {new Date(selectedBooking.startAt).toLocaleString()}
                  </div>
                  <div>
                    <strong>Ende:</strong> {new Date(selectedBooking.endAt).toLocaleString()}
                  </div>
                  {(isAdmin || canEditSelected) && selectedBooking.user?.displayName && (
                    <div>
                      <strong>Person:</strong> {selectedBooking.user.displayName}
                    </div>
                  )}
                  {isAdmin && selectedBooking.user && (
                    <>
                      <div>
                        <strong>Mail:</strong> {selectedBooking.user.email}
                      </div>
                      <div>
                        <strong>Telefon:</strong> {selectedBooking.user.phone ?? 'Nicht hinterlegt'}
                      </div>
                    </>
                  )}
                  {selectedSeriesId && (
                    <div className="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2 text-slate-700">
                      <strong>Serie:</strong>{' '}
                      {recurrenceLabel(selectedBooking.series?.recurrence ?? 'WEEKLY')}
                      {selectedSeriesPendingCount > 0 && isAdmin && (
                        <span className="text-slate-600">
                          {' '}
                          · {selectedSeriesPendingCount} ausstehende Termine in der Serie
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {editingBookingId !== selectedBooking.id &&
                  (canEditSelected ||
                    (isAdmin &&
                      (bookingCanApprove(selectedBooking.status) ||
                        bookingCanReject(selectedBooking.status))) ||
                    (selectedSeriesId &&
                      (canManageSelectedSeries ||
                        (isAdmin && (selectedSeriesCanApprove || selectedSeriesCanReject))))) && (
                  <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    {(canEditSelected ||
                      (isAdmin &&
                        (bookingCanApprove(selectedBooking.status) ||
                          bookingCanReject(selectedBooking.status)))) && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Dieser Termin
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {canEditSelected && (
                            <button
                              type="button"
                              className="rounded border border-teal-700 bg-white px-3 py-2 text-sm text-teal-800"
                              onClick={() => startEditBooking(selectedBooking)}
                            >
                              Bearbeiten
                            </button>
                          )}
                          {isAdmin && bookingCanApprove(selectedBooking.status) && (
                            <button
                              type="button"
                              className="rounded bg-teal-700 px-3 py-2 text-sm text-white"
                              onClick={() =>
                                requestAdminDecision({
                                  scope: 'booking',
                                  action: 'approve',
                                  bookingId: selectedBooking.id,
                                  statusHint: selectedBooking.status,
                                })
                              }
                            >
                              Freigeben
                            </button>
                          )}
                          {isAdmin && bookingCanReject(selectedBooking.status) && (
                            <button
                              type="button"
                              className="rounded bg-rose-600 px-3 py-2 text-sm text-white"
                              onClick={() =>
                                requestAdminDecision({
                                  scope: 'booking',
                                  action: 'reject',
                                  bookingId: selectedBooking.id,
                                  statusHint: selectedBooking.status,
                                })
                              }
                            >
                              Ablehnen
                            </button>
                          )}
                          {canEditSelected && (
                            <button
                              type="button"
                              className="rounded border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700 sm:col-span-2"
                              onClick={() => void deleteBooking()}
                            >
                              Loeschen
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedSeriesId &&
                      (canManageSelectedSeries ||
                        (isAdmin && (selectedSeriesCanApprove || selectedSeriesCanReject))) && (
                      <div
                        className={
                          canEditSelected ||
                          (isAdmin &&
                            (bookingCanApprove(selectedBooking.status) ||
                              bookingCanReject(selectedBooking.status)))
                            ? 'border-t border-slate-200 pt-4'
                            : ''
                        }
                      >
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Serie</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {canManageSelectedSeries && (
                            <>
                              <button
                                type="button"
                                className="rounded border border-teal-700 bg-white px-3 py-2 text-sm text-teal-800"
                                onClick={() => openSeriesForEdit(selectedBooking)}
                              >
                                Bearbeiten
                              </button>
                              <button
                                type="button"
                                className="rounded border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700"
                                onClick={() => void deleteSeries(selectedSeriesId)}
                              >
                                Loeschen
                              </button>
                            </>
                          )}
                          {isAdmin && selectedSeriesCanApprove && (
                            <button
                              type="button"
                              className="rounded bg-teal-700 px-3 py-2 text-sm text-white"
                              onClick={() =>
                                requestAdminDecision({
                                  scope: 'series',
                                  action: 'approve',
                                  seriesId: selectedSeriesId,
                                })
                              }
                            >
                              Freigeben
                            </button>
                          )}
                          {isAdmin && selectedSeriesCanReject && (
                            <button
                              type="button"
                              className="rounded bg-rose-600 px-3 py-2 text-sm text-white"
                              onClick={() =>
                                requestAdminDecision({
                                  scope: 'series',
                                  action: 'reject',
                                  seriesId: selectedSeriesId,
                                })
                              }
                            >
                              Ablehnen
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {canEditSelected && editingBookingId === selectedBooking.id && (
                  <div className="mt-4 rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-medium">Einzelnen Termin bearbeiten</p>
                    {selectedBooking.seriesId && (
                      <p className="mb-3 text-xs text-amber-800">
                        Beim Speichern wird dieser Termin von der Serie getrennt und als eigenstaendige Buchung gefuehrt.
                      </p>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      <select className="rounded border p-2 md:col-span-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                        <option value="">Raum waehlen</option>
                        {(rooms.data ?? []).map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                      <input className="rounded border p-2" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                      <input className="rounded border p-2" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                      <input className="rounded border p-2 md:col-span-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" />
                      <textarea
                        className="min-h-20 rounded border p-2 md:col-span-2"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Beschreibung"
                        rows={3}
                      />
                      <div className="flex flex-wrap gap-2 md:col-span-2">
                        <button type="button" className="rounded bg-teal-700 px-3 py-2 text-white" onClick={() => void saveBookingEdits()}>
                          Termin speichern
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-3 py-2 text-sm"
                          onClick={() => setEditingBookingId(null)}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-4 py-2 text-sm"
                    onClick={() => {
                      setDetailsOpen(false)
                      setDetailsScope('single')
                      setActiveSeriesId(null)
                      setEditingSeries(false)
                      setEditingBookingId(null)
                    }}
                  >
                    Schliessen
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </main>
  )
}

export default App
