import { pararWorker } from './helpers/worker.js';

export default function globalTeardown(): void {
  pararWorker();
}
