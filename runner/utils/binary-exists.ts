import {exec} from 'child_process';

/** Determines if a specific binary exists on the local machine. */
export function binaryExists(name: string): Promise<boolean> {
  return new Promise(resolve => {
    exec(`which ${name}`, error => resolve(!error));
  });
}
