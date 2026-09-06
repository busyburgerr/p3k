import { waves, type Node } from '../util/graph.js'
import type { ProcessSpec } from './config.js'

export { CycleError } from '../util/graph.js'

export const startupWaves = (processes: ProcessSpec[]): ProcessSpec[][] => waves(processes as (ProcessSpec & Node)[])

/** Обратный порядок — для остановки: сначала гасим тех, кто зависит от других. */
export const shutdownOrder = (processes: ProcessSpec[]): ProcessSpec[] => startupWaves(processes).flat().reverse()
