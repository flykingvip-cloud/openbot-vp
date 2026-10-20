import {
  getEvolutionSurface,
  isForbiddenSurfaceId,
  listEvolutionSurfaces,
  type EvolutionSurface,
} from "@openbot/evolution-core";

export function listRegisteredEvolutionSurfaces(): readonly EvolutionSurface[] {
  return listEvolutionSurfaces();
}

export function resolveEvolutionSurface(surfaceId: string): EvolutionSurface | null {
  return getEvolutionSurface(surfaceId);
}

export function assertKnownEvolutionSurface(surfaceId: string): EvolutionSurface {
  const surface = getEvolutionSurface(surfaceId);
  if (!surface) {
    const forbidden = isForbiddenSurfaceId(surfaceId);
    throw new Error(
      forbidden ? `forbidden surface: ${surfaceId}` : `unknown surface: ${surfaceId}`,
    );
  }
  return surface;
}
