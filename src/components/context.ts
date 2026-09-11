import { createContextId } from '@builder.io/qwik';
import type { DeviceManager } from '../device/serial';

export const DeviceContext= createContextId<DeviceManager>('devices');
