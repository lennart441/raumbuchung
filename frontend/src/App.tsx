import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { UserManager, WebStorageStateStore } from 'oidc-client-ts'

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
type Booking = {
  id: string
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
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api',
})

const authMode = (import.meta.env.VITE_AUTH_MODE ?? 'oidc').toLowerCase()
const isOidcMode = authMode === 'oidc'

type Recurrence = 'DAILY' | 'WEEKLY' | 'MONTHLY'

type SeriesOccurrencePreview = {
  startAt: string
  endAt: string
  conflict: boolean
  reason?: string
}

const roleLabels: Record<Me['role'], string> = {
  USER: 'User',
  EXTENDED_USER: 'Extended',
  ADMIN: 'Admin',
}

const DAY_START_HOUR = 0
const DAY_END_HOUR = 24
const TIMELINE_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60

function toLocalInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
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
  const [selectedRole, setSelectedRole] = useState<Me['role']>('USER')
  const [isDevLoggedIn, setIsDevLoggedIn] = useState(false)
  const [oidcToken, setOidcToken] = useState<string | null>(null)

  const [devUser, setDevUser] = useState('mvp-user')
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
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
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
  const [approvalTabOpen, setApprovalTabOpen] = useState(true)
  const [selectedBookingId, setSelectedBookingId] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)

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
  }, [])

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
  }, [oidcManager])

  const isLoggedIn = isOidcMode ? Boolean(oidcToken) : isDevLoggedIn

  const headers = useMemo(() => {
    if (isOidcMode && oidcToken) return { authorization: `Bearer ${oidcToken}` }
    return { 'x-dev-user': devUser, 'x-dev-role': devRole }
  }, [devRole, devUser, oidcToken])

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

  const selectedBooking = useMemo(() => {
    if (!selectedBookingId) return null
    if (knownBookingsById.has(selectedBookingId)) return knownBookingsById.get(selectedBookingId) ?? null
    for (const row of roomCalendar) {
      const match = row.bookings.find((booking) => booking.id === selectedBookingId)
      if (match) return match
    }
    return null
  }, [knownBookingsById, roomCalendar, selectedBookingId])

  const canEditSelected = useMemo(() => {
    if (!selectedBooking || selectedBooking.id.startsWith('block-')) return false
    if (isAdmin) return true
    return (bookings.data ?? []).some((booking) => booking.id === selectedBooking.id)
  }, [bookings.data, isAdmin, selectedBooking])

  const refreshAll = async () => {
    await bookings.refetch()
    await availability.refetch()
    if (isAdmin) await adminBookings.refetch()
  }

  const createBooking = async () => {
    if (!roomId || !startAt || !endAt) return
    if (showRecurrence) return
    await api.post('/bookings', { roomId, startAt, endAt, title, description }, { headers })
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
          startAt,
          endAt,
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
          startAt,
          endAt,
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
    await api.patch(`/bookings/${editingBookingId}`, { roomId, startAt, endAt, title, description }, { headers })
    await refreshAll()
    setDetailsOpen(false)
    setEditingBookingId(null)
  }

  const deleteBooking = async () => {
    if (!selectedBooking || selectedBooking.id.startsWith('block-')) return
    await api.delete(`/bookings/${selectedBooking.id}`, { headers })
    await refreshAll()
    setDetailsOpen(false)
    setEditingBookingId(null)
    setSelectedBookingId('')
  }

  const decide = async (id: string, action: 'approve' | 'reject') => {
    await api.patch(`/admin/bookings/${id}/${action}`, {}, { headers })
    await refreshAll()
  }

  const handleRoleLogin = () => {
    setDevRole(selectedRole)
    setDevUser(selectedRole === 'ADMIN' ? 'mvp-admin' : selectedRole === 'EXTENDED_USER' ? 'mvp-power-user' : 'mvp-user')
    setIsDevLoggedIn(true)
  }

  const handleOidcLogin = async () => {
    if (!oidcManager) return
    await oidcManager.signinRedirect()
  }

  const handleLogout = async () => {
    if (isOidcMode && oidcManager) {
      await oidcManager.removeUser()
      setOidcToken(null)
      await oidcManager.signoutRedirect()
      return
    }
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

  const openDetails = (booking: Booking, room: Room) => {
    setSelectedBookingId(booking.id)
    setRoomId(rooms.data?.find((r) => r.name === room.name)?.id ?? '')
    setStartAt(toLocalInputValue(new Date(booking.startAt)))
    setEndAt(toLocalInputValue(new Date(booking.endAt)))
    setTitle(booking.title ?? '')
    setDescription(booking.description ?? '')
    setDetailsOpen(true)
    setEditingBookingId(null)
  }

  const pendingBookings = (adminBookings.data ?? []).filter((booking) => booking.status.toUpperCase() === 'PENDING')

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
    return (
      <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 shadow sm:mt-16">
          <h1 className="text-2xl font-semibold">Gemeinde Stocksee</h1>
          <p className="mt-1 text-sm text-slate-600">Raumbuchung</p>
          {isOidcMode ? (
            <>
              <p className="mt-2 text-xs text-slate-500">Anmeldung ueber Authentik (OIDC/PKCE).</p>
              {!oidcManager && (
                <p className="mt-2 text-xs text-rose-700">
                  OIDC ist aktiv, aber `VITE_AUTHENTIK_OIDC_*` ist unvollstaendig konfiguriert.
                </p>
              )}
              {authError && <p className="mt-2 text-xs text-rose-700">{authError}</p>}
              <button className="mt-5 w-full rounded-lg bg-teal-700 px-3 py-2 font-medium text-white" onClick={handleOidcLogin}>
                Mit Gemeinde Stocksee Konto anmelden
              </button>
            </>
          ) : (
            <>
              <p className="mt-2 text-xs text-slate-500">Demo-Login (ohne echtes Auth). Bitte Rolle auswaehlen.</p>
              <div className="mt-5 space-y-2">
                {(['USER', 'EXTENDED_USER', 'ADMIN'] as Me['role'][]).map((role) => (
                  <button
                    key={role}
                    onClick={() => setSelectedRole(role)}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      selectedRole === role ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200'
                    }`}
                  >
                    {roleLabels[role]}
                  </button>
                ))}
              </div>
              <button className="mt-5 w-full rounded-lg bg-teal-700 px-3 py-2 font-medium text-white" onClick={handleRoleLogin}>
                Weiter
              </button>
            </>
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
              {me.data?.displayName ?? devUser} · <strong>{roleLabels[me.data?.role ?? devRole]}</strong>
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
      </header>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="text-lg font-semibold">Mein Profil (readonly)</h2>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
      </section>

      <div className="grid gap-4 2xl:grid-cols-[280px_1fr_360px]">
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

          <div className="max-w-full overflow-x-auto touch-pan-x">
            <div className="min-w-[760px]">
              {/* Kopfzeile (Raum-Spalte sticky, Zeitachse scrollt) */}
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
                        const startMinutes = (new Date(booking.startAt).getTime() - dayStart.getTime()) / 60000
                        const endMinutes = (new Date(booking.endAt).getTime() - dayStart.getTime()) / 60000
                        const clampedStart = Math.max(0, Math.min(startMinutes, TIMELINE_MINUTES))
                        const clampedEnd = Math.max(0, Math.min(endMinutes, TIMELINE_MINUTES))
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
                                    canSeePerson && booking.user?.displayName ? ` (${booking.user.displayName})` : ''
                                  }`
                            }
                          >
                            <span className="block truncate text-left leading-tight">
                              {booking.isMasked ? 'Blockiert' : displayBookingTitle(booking)}
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

        {/* Mobile/Tablet: Buchungen als Akkordeon */}
        <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 2xl:hidden">
          <summary className="cursor-pointer select-none text-lg font-semibold">Buchungen</summary>
          <div className="mt-4 space-y-4">
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
              title={isExtended ? 'Erstellt sofort eine bestaetigte Buchung' : 'Sendet eine Buchungsanfrage zur Pruefung'}
            >
              {isExtended ? 'Direkt buchen' : 'Buchung anfragen'}
            </button>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Meine Buchungen</h3>
              <ul className="space-y-2">
                {(bookings.data ?? []).slice(0, 8).map((booking) => (
                  <li key={booking.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                    <button
                      className="w-full text-left"
                      onClick={() => {
                        setSelectedBookingId(booking.id)
                        setDetailsOpen(true)
                      }}
                      title="Details anzeigen und ggf. bearbeiten"
                    >
                      <div className="font-medium">{booking.room?.name ?? 'Raum'}</div>
                      <div>{new Date(booking.startAt).toLocaleString()}</div>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 ${bookingClass(booking.status)}`}>
                        {bookingStatusLabel(booking.status)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {isAdmin && (
              <div className="rounded-xl border border-slate-200 p-3">
                <button
                  className="mb-2 text-left text-sm font-semibold text-teal-800"
                  onClick={() => setApprovalTabOpen((prev) => !prev)}
                  title="Zeigt oder versteckt offene Genehmigungsanfragen"
                >
                  Genehmigungs-Tab ({pendingBookings.length})
                </button>
                {approvalTabOpen && (
                  <ul className="space-y-2">
                    {pendingBookings.map((booking) => (
                      <li key={booking.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                        <div className="font-medium">
                          {booking.user?.displayName} · {booking.room?.name}
                        </div>
                        <div className="mb-2">{new Date(booking.startAt).toLocaleString()}</div>
                        <div className="flex gap-2">
                          <button className="rounded bg-teal-700 px-2 py-1 text-white" onClick={() => decide(booking.id, 'approve')}>
                            Freigeben
                          </button>
                          <button className="rounded bg-rose-600 px-2 py-1 text-white" onClick={() => decide(booking.id, 'reject')}>
                            Ablehnen
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </details>

        {/* Desktop/Wideboard: Buchungen rechts fix */}
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
            title={isExtended ? 'Erstellt sofort eine bestaetigte Buchung' : 'Sendet eine Buchungsanfrage zur Pruefung'}
          >
            {isExtended ? 'Direkt buchen' : 'Buchung anfragen'}
          </button>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Meine Buchungen</h3>
            <ul className="space-y-2">
              {(bookings.data ?? []).slice(0, 6).map((booking) => (
                <li key={booking.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                  <button
                    className="w-full text-left"
                    onClick={() => {
                      setSelectedBookingId(booking.id)
                      setDetailsOpen(true)
                    }}
                    title="Details anzeigen und ggf. bearbeiten"
                  >
                    <div className="font-medium">{booking.room?.name ?? 'Raum'}</div>
                    <div>{new Date(booking.startAt).toLocaleString()}</div>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 ${bookingClass(booking.status)}`}>
                      {bookingStatusLabel(booking.status)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {isAdmin && (
            <div className="rounded-xl border border-slate-200 p-3">
              <button
                className="mb-2 text-left text-sm font-semibold text-teal-800"
                onClick={() => setApprovalTabOpen((prev) => !prev)}
                title="Zeigt oder versteckt offene Genehmigungsanfragen"
              >
                Genehmigungs-Tab ({pendingBookings.length})
              </button>
              {approvalTabOpen && (
                <ul className="space-y-2">
                  {pendingBookings.map((booking) => (
                    <li key={booking.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                      <div className="font-medium">
                        {booking.user?.displayName} · {booking.room?.name}
                      </div>
                      <div className="mb-2">{new Date(booking.startAt).toLocaleString()}</div>
                      <div className="flex gap-2">
                        <button className="rounded bg-teal-700 px-2 py-1 text-white" onClick={() => decide(booking.id, 'approve')}>
                          Freigeben
                        </button>
                        <button className="rounded bg-rose-600 px-2 py-1 text-white" onClick={() => decide(booking.id, 'reject')}>
                          Ablehnen
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

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

      {detailsOpen && selectedBooking && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Buchungsdetails</h3>
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
                  <div>
                    <strong>Strasse:</strong> {selectedBooking.user.street ?? 'Nicht hinterlegt'}{' '}
                    {selectedBooking.user.houseNumber ?? ''}
                  </div>
                  <div>
                    <strong>PLZ / Stadt:</strong> {selectedBooking.user.postalCode ?? '-'} {selectedBooking.user.city ?? ''}
                  </div>
                  <div>
                    <strong>Geburtsdatum:</strong> {formatBirthDate(selectedBooking.user.birthDate)}
                  </div>
                </>
              )}
            </div>

            {canEditSelected && (
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <button
                  className="mb-3 rounded border border-slate-300 px-3 py-1 text-sm"
                  onClick={() => {
                    setEditingBookingId(selectedBooking.id)
                    setRoomId(rooms.data?.find((room) => room.name === selectedBooking.room?.name)?.id ?? '')
                    setStartAt(toLocalInputValue(new Date(selectedBooking.startAt)))
                    setEndAt(toLocalInputValue(new Date(selectedBooking.endAt)))
                    setTitle(selectedBooking.title ?? '')
                    setDescription(selectedBooking.description ?? '')
                  }}
                >
                  Termin bearbeiten
                </button>
                {editingBookingId === selectedBooking.id && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <select className="rounded border p-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
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
                    <button className="rounded bg-teal-700 px-3 py-2 text-white md:col-span-2" onClick={saveBookingEdits}>
                      Aenderungen speichern
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-between gap-2">
              {canEditSelected && (
                <button className="rounded bg-rose-600 px-3 py-2 text-white" onClick={deleteBooking}>
                  Termin loeschen
                </button>
              )}
              <button className="rounded border px-3 py-2" onClick={() => setDetailsOpen(false)}>
                Schliessen
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
