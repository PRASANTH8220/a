import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  autoConnect: true,
});

socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('[Socket] Disconnected:', reason);
});

socket.on('connect_error', (err) => {
  console.error('[Socket] Connection error:', err.message);
});

export default socket;
