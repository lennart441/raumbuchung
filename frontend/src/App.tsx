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
  note?: string
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

type Equipment = 'beamer' | 'tv' | 'whiteboard'
type Recurrence = 'DAILY' | 'WEEKLY' | 'MONTHLY'

const roleLabels: Record<Me['role'], string> = {
  USER: 'User',
  EXTENDED_USER: 'Extended',
  ADMIN: 'Admin',
}

const DAY_START_HOUR = 0
const DAY_END_HOUR = 24
const TIMELINE_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60

const roomPalette = [
  { equipment: ['whiteboard'] as Equipment[] },
  { equipment: ['beamer', 'whiteboard'] as Equipment[] },
  { equipment: ['tv'] as Equipment[] },
  { equipment: ['beamer', 'tv'] as Equipment[] },
  { equipment: ['beamer', 'tv', 'whiteboard'] as Equipment[] },
]

type DecoratedRoom = Room & { equipment: Equipment[] }

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
  const title = booking.note?.trim()
  return title && title.length > 0 ? title : 'Termin'
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
  const [equipmentFilter, setEquipmentFilter] = useState<Equipment[]>([])
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
  const [note, setNote] = useState('')
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [recurrence, setRecurrence] = useState<Recurrence>('WEEKLY')
  const [recurrenceUntil, setRecurrenceUntil] = useState('')
  const [approvalTabOpen, setApprovalTabOpen] = useState(true)
  const [selectedBookingId, setSelectedBookingId] = useState('')

  const oidcManager = useMemo(() => {
    if (!isOidcMode) return null
    const authority = import.meta.env.VITE_AUTHENTIK_ISSUER as string | undefined
    const clientId = import.meta.env.VITE_AUTHENTIK_CLIENT_ID as string | undefined
    const redirectUri = import.meta.env.VITE_AUTHENTIK_REDIRECT_URI as string | undefined
    if (!authority || !clientId || !redirectUri) return null
    return new UserManager({
      authority,
      client_id: clientId,
      redirect_uri: redirectUri,
      post_logout_redirect_uri:
        (import.meta.env.VITE_AUTHENTIK_POST_LOGOUT_REDIRECT_URI as string | undefined) ??
        window.location.origin,
      response_type: 'code',
      scope: (import.meta.env.VITE_AUTHENTIK_SCOPE as string | undefined) ?? 'openid profile email',
      userStore: new WebStorageStateStore({ store: window.localStorage }),
    })
  }, [])

  useEffect(() => {
    if (!isOidcMode || !oidcManager) return
    const search = new URLSearchParams(window.location.search)
    const hasCallbackParams = search.has('code') && search.has('state')
    const bootstrap = async () => {
      if (hasCallbackParams) {
        await oidcManager.signinRedirectCallback()
        window.history.replaceState({}, document.title, window.location.pathname)
      }
      const user = await oidcManager.getUser()
      setOidcToken(user?.access_token ?? null)
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

  const decoratedRooms: DecoratedRoom[] = useMemo(
    () =>
      (rooms.data ?? []).map((room, idx) => {
        const mapped = roomPalette[idx % roomPalette.length]
        return { ...room, ...mapped }
      }),
    [rooms.data],
  )

  const filteredRooms = useMemo(() => {
    return decoratedRooms.filter((room) => {
      if (equipmentFilter.length > 0 && !equipmentFilter.every((eq) => room.equipment.includes(eq))) return false
      return true
    })
  }, [decoratedRooms, equipmentFilter])

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
            note: isOwnOrVisible ? knownBooking?.note : 'Blockiert',
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
          note: 'Wartung / Block',
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
    await api.post('/bookings', { roomId, startAt, endAt, note }, { headers })
    await refreshAll()
    setNote('')
    setModalOpen(false)
  }

  const saveBookingEdits = async () => {
    if (!selectedBooking || !editingBookingId || !roomId || !startAt || !endAt) return
    await api.patch(`/bookings/${editingBookingId}`, { roomId, startAt, endAt, note }, { headers })
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

  const handleEquipmentToggle = (equipment: Equipment) => {
    setEquipmentFilter((current) =>
      current.includes(equipment) ? current.filter((entry) => entry !== equipment) : [...current, equipment],
    )
  }

  const openModalForSelection = (room: DecoratedRoom, fromPx: number, toPx: number, width: number) => {
    const startMinutes = Math.floor(Math.min(pxToMinutes(fromPx, width), pxToMinutes(toPx, width)) / 15) * 15
    const endMinutes = Math.ceil(Math.max(pxToMinutes(fromPx, width), pxToMinutes(toPx, width)) / 15) * 15
    const dayStart = dayStartFromInput(selectedDay)
    const start = minutesToDate(dayStart, startMinutes)
    const end = minutesToDate(dayStart, Math.max(startMinutes + 30, endMinutes))
    setRoomId(room.id)
    setStartAt(toLocalInputValue(start))
    setEndAt(toLocalInputValue(end))
    setNote('')
    setModalOpen(true)
  }

  const openDetails = (booking: Booking, room: DecoratedRoom) => {
    setSelectedBookingId(booking.id)
    setRoomId(rooms.data?.find((r) => r.name === room.name)?.id ?? '')
    setStartAt(toLocalInputValue(new Date(booking.startAt)))
    setEndAt(toLocalInputValue(new Date(booking.endAt)))
    setNote(booking.note ?? '')
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
              <button className="mt-5 w-full rounded-lg bg-teal-700 px-3 py-2 font-medium text-white" onClick={handleOidcLogin}>
                Mit Authentik anmelden
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
              <label className="mb-2 block text-sm font-medium">Equipment</label>
              <div className="space-y-2 text-sm">
                {(['beamer', 'tv', 'whiteboard'] as Equipment[]).map((item) => (
                  <label key={item} className="flex items-center gap-2">
                    <input type="checkbox" checked={equipmentFilter.includes(item)} onChange={() => handleEquipmentToggle(item)} />
                    {item}
                  </label>
                ))}
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
            <label className="mb-2 block text-sm font-medium">Equipment</label>
            <div className="space-y-2 text-sm">
              {(['beamer', 'tv', 'whiteboard'] as Equipment[]).map((item) => (
                <label key={item} className="flex items-center gap-2">
                  <input type="checkbox" checked={equipmentFilter.includes(item)} onChange={() => handleEquipmentToggle(item)} />
                  {item}
                </label>
              ))}
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
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Buchung anfragen</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Raum</span>
                <select className="w-full rounded border p-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  <option value="">Raum waehlen</option>
                  {decoratedRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Startdatum</span>
                <input className="w-full rounded border p-2" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Enddatum</span>
                <input className="w-full rounded border p-2" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-700">Titel</span>
                <input className="w-full rounded border p-2" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showRecurrence} onChange={(e) => setShowRecurrence(e.target.checked)} />
              Serienbuchung aktivieren
            </label>
            {showRecurrence && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <select className="rounded border p-2" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                  <option value="DAILY">Taeglich</option>
                  <option value="WEEKLY">Woechentlich</option>
                  <option value="MONTHLY">Monatlich</option>
                </select>
                <input className="rounded border p-2" type="date" value={recurrenceUntil} onChange={(e) => setRecurrenceUntil(e.target.value)} />
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-3 py-2" onClick={() => setModalOpen(false)}>
                Abbrechen
              </button>
              <button className="rounded bg-teal-700 px-3 py-2 text-white" onClick={createBooking}>
                {isExtended ? 'Direkt buchen' : 'Anfrage senden'}
              </button>
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
              {selectedBooking.note && (
                <div>
                  <strong>Notiz:</strong> {selectedBooking.note}
                </div>
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
                    setNote(selectedBooking.note ?? '')
                  }}
                >
                  Termin bearbeiten
                </button>
                {editingBookingId === selectedBooking.id && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <select className="rounded border p-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                      <option value="">Raum waehlen</option>
                      {decoratedRooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                    <input className="rounded border p-2" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                    <input className="rounded border p-2" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                    <input className="rounded border p-2 md:col-span-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Titel" />
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
