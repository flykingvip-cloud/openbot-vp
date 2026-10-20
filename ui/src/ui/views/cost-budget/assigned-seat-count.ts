/**
 * One occupied-seat count for plan chips, usage bars, and the growth path.
 * An empty allocation array must not hide a populated roster (`??` treats 0 as real).
 */

type SeatLike = { userId?: string | null };

function occupiedCount(seats: readonly SeatLike[] | null | undefined): number | null {
  if (!seats || seats.length === 0) {
    return null;
  }
  const withUser = seats.filter((seat) => (seat.userId ?? "").trim().length > 0).length;
  return withUser > 0 ? withUser : seats.length;
}

export function resolveAssignedSeatCount(input: {
  allocationSeats?: readonly SeatLike[] | null;
  rosterSeats?: readonly SeatLike[] | null;
}): number {
  return occupiedCount(input.allocationSeats) ?? occupiedCount(input.rosterSeats) ?? 0;
}
