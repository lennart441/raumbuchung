import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

type Me = { id: string; displayName: string; role: 'USER' | 'EXTENDED_USER' | 'ADMIN' }
type Room = { id: string; name: string }
type Booking = {
  id: string
  startAt: string
  endAt: string
  status: string
  isOverbooked: boolean
  room?: { name: string }
  user?: { displayName: string; email: string }
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api',
})

type AppMode = 'CALENDAR' | 'FIND_ROOM'

const roleLabels: Record<Me['role'], string> = {
  USER: 'User',
  EXTENDED_USER: 'Erweiterter User',
  ADMIN: 'Admin',
}

function App() {
  const [selectedRole, setSelectedRole] = useState<Me['role']>('USER')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [appMode, setAppMode] = useState<AppMode>('CALENDAR')

  const [devUser, setDevUser] = useState('mvp-user')
  const [devRole, setDevRole] = useState<Me['role']>('USER')
  const [roomId, setRoomId] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [note, setNote] = useState('')
  const [searchStartAt, setSearchStartAt] = useState('')
  const [searchEndAt, setSearchEndAt] = useState('')
  const [searchLocation, setSearchLocation] = useState('Alle')

  const headers = useMemo(
    () => ({ 'x-dev-user': devUser, 'x-dev-role': devRole }),
    [devRole, devUser],
  )

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

  const createBooking = async () => {
    if (!roomId || !startAt || !endAt) return
    await api.post(
      '/bookings',
      { roomId, startAt, endAt, note },
      { headers },
    )
    await bookings.refetch()
    if (me.data?.role === 'ADMIN') await adminBookings.refetch()
    setNote('')
  }

  const decide = async (id: string, action: 'approve' | 'reject') => {
    await api.patch(`/admin/bookings/${id}/${action}`, {}, { headers })
    await adminBookings.refetch()
  }

  const effectiveBookings = me.data?.role === 'ADMIN' ? adminBookings.data : bookings.data

  const roomCalendar = useMemo(() => {
    return (rooms.data ?? []).map((room) => {
      const roomBookings = (effectiveBookings ?? []).filter((booking) => booking.room?.name === room.name)
      return { room, bookings: roomBookings }
    })
  }, [effectiveBookings, rooms.data])

  const availableLocations = useMemo(() => {
    const tags = new Set<string>(['Alle'])
    for (const room of rooms.data ?? []) {
      if (room.name.toLowerCase().includes('ost')) tags.add('Ost')
      else if (room.name.toLowerCase().includes('west')) tags.add('West')
      else if (room.name.toLowerCase().includes('sued') || room.name.toLowerCase().includes('süd')) tags.add('Sued')
      else if (room.name.toLowerCase().includes('nord')) tags.add('Nord')
      else tags.add('Zentrale')
    }
    return Array.from(tags)
  }, [rooms.data])

  const suggestedRooms = useMemo(() => {
    const searchStart = searchStartAt ? new Date(searchStartAt).getTime() : undefined
    const searchEnd = searchEndAt ? new Date(searchEndAt).getTime() : undefined

    const hasConflict = (roomName: string) =>
      (effectiveBookings ?? []).some((booking) => {
        if (booking.room?.name !== roomName) return false
        const bookingStart = new Date(booking.startAt).getTime()
        const bookingEnd = new Date(booking.endAt).getTime()
        if (!searchStart || !searchEnd) return false
        return searchStart < bookingEnd && searchEnd > bookingStart
      })

    const locationMatches = (roomName: string) => {
      if (searchLocation === 'Alle') return true
      if (searchLocation === 'Zentrale') {
        return !['ost', 'west', 'sued', 'süd', 'nord'].some((tag) => roomName.toLowerCase().includes(tag))
      }
      return roomName.toLowerCase().includes(searchLocation.toLowerCase())
    }

    return (rooms.data ?? []).filter((room) => {
      if (!locationMatches(room.name)) return false
      if (searchStart && searchEnd) return !hasConflict(room.name)
      return true
    })
  }, [effectiveBookings, rooms.data, searchEndAt, searchLocation, searchStartAt])

  const handleRoleLogin = () => {
    setDevRole(selectedRole)
    setDevUser(selectedRole === 'ADMIN' ? 'mvp-admin' : selectedRole === 'EXTENDED_USER' ? 'mvp-power-user' : 'mvp-user')
    setIsLoggedIn(true)
  }

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-6 shadow">
          <h1 className="text-2xl font-semibold">Raumbuchung</h1>
          <p className="mt-1 text-sm text-slate-600">
            MVP Login-Screen (ohne echtes Auth). Bitte Rolle auswahlen.
          </p>

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

          <button
            className="mt-5 w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white"
            onClick={handleRoleLogin}
          >
            Weiter zum Dashboard
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <header className="mb-6 rounded-2xl bg-white p-4 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Raumbuchung</h1>
            <p className="text-sm text-slate-600">
              MVP Dashboard fur produktionsnahen Ablauf.
            </p>
          </div>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onClick={() => setIsLoggedIn(false)}
          >
            Abmelden
          </button>
        </div>
      </header>

      <section className="mb-6 grid gap-3 rounded-2xl bg-white p-4 shadow md:grid-cols-3">
        <div className="rounded border p-2 text-sm">
          Rolle: <strong>{roleLabels[devRole]}</strong>
        </div>
        <div className="rounded border p-2 text-sm">
          Benutzer: <strong>{me.data?.displayName ?? devUser}</strong>
        </div>
        <div className="rounded border p-2 text-sm">
          Betriebsmodus: <strong>Produktionsnahes MVP</strong>
        </div>
      </section>

      <section className="mb-6 rounded-2xl bg-white p-4 shadow">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          <button
            className={`rounded-lg px-3 py-2 text-sm ${appMode === 'CALENDAR' ? 'bg-white shadow' : ''}`}
            onClick={() => setAppMode('CALENDAR')}
          >
            Alle Raume & Kalender
          </button>
          <button
            className={`rounded-lg px-3 py-2 text-sm ${appMode === 'FIND_ROOM' ? 'bg-white shadow' : ''}`}
            onClick={() => setAppMode('FIND_ROOM')}
          >
            Raum finden
          </button>
        </div>
      </section>

      {appMode === 'CALENDAR' && (
        <section className="mb-6 rounded-2xl bg-white p-4 shadow">
          <h2 className="mb-3 text-lg font-semibold">Raumkalender</h2>
          <div className="space-y-4">
            {roomCalendar.map(({ room, bookings: roomBookings }) => (
              <div key={room.id} className="rounded-xl border p-3">
                <h3 className="font-medium">{room.name}</h3>
                {roomBookings.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">Keine Eintrage fur diesen Raum.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {roomBookings.map((booking) => (
                      <li key={booking.id}>
                        {new Date(booking.startAt).toLocaleString()} - {new Date(booking.endAt).toLocaleString()}
                        <span className="ml-2 rounded bg-slate-200 px-2 py-1">{booking.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {appMode === 'FIND_ROOM' && (
        <section className="mb-6 rounded-2xl bg-white p-4 shadow">
          <h2 className="mb-3 text-lg font-semibold">Raum finden</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              className="rounded border p-2"
              type="datetime-local"
              value={searchStartAt}
              onChange={(e) => setSearchStartAt(e.target.value)}
            />
            <input
              className="rounded border p-2"
              type="datetime-local"
              value={searchEndAt}
              onChange={(e) => setSearchEndAt(e.target.value)}
            />
            <select
              className="rounded border p-2"
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
            >
              {availableLocations.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Zeitraum und Standort angeben, dann werden passende Raume vorgeschlagen.
          </p>

          <ul className="mt-4 space-y-2">
            {suggestedRooms.map((room) => (
              <li key={room.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>{room.name}</div>
                  <button
                    className="rounded bg-slate-900 px-3 py-1 text-white"
                    onClick={() => {
                      setRoomId(room.id)
                      setStartAt(searchStartAt)
                      setEndAt(searchEndAt)
                    }}
                  >
                    Fur Buchung ubernehmen
                  </button>
                </div>
              </li>
            ))}
            {suggestedRooms.length === 0 && (
              <li className="rounded border p-3 text-sm text-slate-500">
                Keine passenden Raume gefunden.
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="mb-6 rounded-2xl bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-semibold">Buchung anfragen</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <select className="rounded border p-2" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Raum wahlen</option>
            {rooms.data?.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
          <input className="rounded border p-2" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <input className="rounded border p-2" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          <input className="rounded border p-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Zweck / Notiz" />
        </div>
        <button className="mt-3 rounded bg-emerald-600 px-3 py-2 text-white" onClick={createBooking}>
          Anfrage senden
        </button>
      </section>

      {me.data?.role === 'ADMIN' && (
        <section className="rounded-2xl bg-white p-4 shadow">
          <h2 className="mb-3 text-lg font-semibold">Admin Übersicht</h2>
          <ul className="space-y-2">
            {adminBookings.data?.map((booking) => (
              <li key={booking.id} className="rounded border p-3 text-sm">
                {booking.user?.displayName} hat {booking.room?.name} am {new Date(booking.startAt).toLocaleString()} gebucht
                <span className="ml-2 rounded bg-slate-200 px-2 py-1">{booking.status}</span>
                {booking.isOverbooked && <span className="ml-2 rounded bg-red-200 px-2 py-1">Überbucht</span>}
                {booking.status === 'PENDING' && (
                  <span className="ml-3 inline-flex gap-2">
                    <button className="rounded bg-emerald-600 px-2 py-1 text-white" onClick={() => decide(booking.id, 'approve')}>Freigeben</button>
                    <button className="rounded bg-rose-600 px-2 py-1 text-white" onClick={() => decide(booking.id, 'reject')}>Ablehnen</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

export default App
