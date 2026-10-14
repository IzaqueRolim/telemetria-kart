import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Ack,
  EV,
  GeneralReport,
  LapEvent,
  LivePosition,
  SessionSnapshot,
  StandingRow,
  StartFinishLine,
} from '@kart/shared';
import { SERVER_URL } from './api';

export interface FeedItem extends LapEvent {
  key: string;
  at: number;
}

export interface LiveState {
  connected: boolean;
  error: string | null;
  session: SessionSnapshot | null;
  standings: StandingRow[];
  positions: Record<string, LivePosition>;
  feed: FeedItem[];
  report: GeneralReport | null;
  /** serverTime - Date.now() */
  clockOffset: number;
}

const INITIAL: LiveState = {
  connected: false,
  error: null,
  session: null,
  standings: [],
  positions: {},
  feed: [],
  report: null,
  clockOffset: 0,
};

/** Assina a sala como espectador e mantém o estado ao vivo. */
export function useLiveSession(code: string): LiveState {
  const [state, setState] = useState<LiveState>(INITIAL);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    setState(INITIAL);
    const socket = io(SERVER_URL || undefined, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const join = async () => {
      try {
        const r = (await socket.timeout(8000).emitWithAck(EV.SPECTATOR_JOIN, { code })) as Ack<SessionSnapshot>;
        if (!r.ok || !r.data) {
          setState((s) => ({ ...s, error: r.error ?? 'Sala não encontrada' }));
          return;
        }
        const snap = r.data;
        setState((s) => ({
          ...s,
          connected: true,
          error: null,
          session: snap,
          standings: snap.standings,
          clockOffset: snap.serverTime - Date.now(),
        }));
      } catch {
        setState((s) => ({ ...s, error: 'Sem resposta do servidor' }));
      }
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setState((s) => ({ ...s, connected: false })));
    socket.on(EV.STATE, (snap: SessionSnapshot) =>
      setState((s) => ({ ...s, session: snap, standings: snap.standings, clockOffset: snap.serverTime - Date.now() })),
    );
    socket.on(EV.LINE, (line: StartFinishLine) =>
      setState((s) => (s.session ? { ...s, session: { ...s.session, line } } : s)),
    );
    socket.on(EV.STANDINGS, (p: { standings: StandingRow[] }) => setState((s) => ({ ...s, standings: p.standings })));
    socket.on(EV.POSITIONS, (p: { serverTime: number; positions: LivePosition[] }) =>
      setState((s) => {
        const positions: Record<string, LivePosition> = {};
        for (const x of p.positions) positions[x.pilotId] = x;
        return { ...s, positions, clockOffset: p.serverTime - Date.now() };
      }),
    );
    socket.on(EV.LAP, (e: LapEvent) =>
      setState((s) => ({
        ...s,
        feed: [{ ...e, key: `${e.pilotId}-${e.lap.number}-${e.lap.endT}`, at: Date.now() }, ...s.feed].slice(0, 14),
      })),
    );
    socket.on(EV.FINISHED, (report: GeneralReport) => setState((s) => ({ ...s, report })));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [code]);

  return state;
}
