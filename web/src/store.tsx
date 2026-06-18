import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { api, API_BASE, getToken, setApiHooks } from "./api";
import type {
  Agent,
  AgentEvent,
  Analytics,
  AppConfig,
  Booking,
  BookingStatus,
  Call,
  ChatMessage,
  User,
  ViewName
} from "./types";

const TOKEN_KEY = "vaos_token";
const USER_KEY = "vaos_user";
const AGENT_KEY = "vaos_selected_agent";

type Screen = "auth" | "loading" | "app";
type ToastType = "info" | "error" | "warning";
interface Toast {
  msg: string;
  type: ToastType;
  id: number;
}

interface CreateAgentInput {
  businessName: string;
  agentName: string;
  businessType: string;
  description: string;
  hours?: string;
  address?: string;
  systemPrompt?: string;
  bookingEnabled: boolean;
  phoneCountry: string;
}

interface GeneratePromptInput {
  businessName: string;
  agentName: string;
  businessType: string;
  description: string;
  hours?: string;
  address?: string;
}

interface Store {
  user: User | null;
  agents: Agent[];
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  calls: Call[];
  selectedCallId: string | null;
  bookings: Booking[];
  analytics: Analytics | null;
  events: AgentEvent[];
  config: AppConfig;
  screen: Screen;
  view: ViewName;
  bookingFilter: "all" | BookingStatus;
  sseConnected: boolean;
  toast: Toast | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setView: (v: ViewName) => void;
  selectAgent: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  provisionAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  resumeAgent: (id: string) => Promise<void>;
  savePrompt: (id: string, systemPrompt: string, voice?: string) => Promise<void>;
  updateBookingStatus: (bookingId: string, status: BookingStatus) => Promise<void>;
  setSelectedCallId: (id: string) => void;
  loadCallDetail: (callId: string) => Promise<void>;
  createAgent: (input: CreateAgentInput, file?: File | null) => Promise<Agent>;
  generatePrompt: (input: GeneratePromptInput) => Promise<{ systemPrompt: string; bookingEnabled: boolean } | null>;
  testChat: (messages: ChatMessage[]) => Promise<{ reply: string; endCall: boolean }>;
  setBookingFilter: (f: "all" | BookingStatus) => void;
  showToast: (msg: string, type?: ToastType) => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(localStorage.getItem(AGENT_KEY));
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [config, setConfig] = useState<AppConfig>({ twilioPhone: null, publicBaseUrl: null });
  const [screen, setScreen] = useState<Screen>("auth");
  const [view, setView] = useState<ViewName>("dashboard");
  const [bookingFilter, setBookingFilter] = useState<"all" | BookingStatus>("all");
  const [sseConnected, setSseConnected] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Refs that always hold the latest values for use inside async callbacks / SSE.
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;
  const selectedAgentIdRef = useRef<string | null>(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const sseRef = useRef<EventSource | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: ToastType = "info") => {
    setToast({ msg, type, id: Date.now() });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setSseConnected(false);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAgents([]);
    setSelectedAgentId(null);
    closeSse();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(AGENT_KEY);
    setScreen("auth");
  }, [closeSse]);

  useEffect(() => {
    setApiHooks({ onUnauthorized: logout });
  }, [logout]);

  const loadAgentData = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      try {
        const [analyticsRes, callsRes, bookingsRes] = await Promise.all([
          api.get<{ analytics: Analytics; events: AgentEvent[] }>(`/api/agents/${agentId}/analytics`),
          api.get<{ calls: Call[] }>(`/api/agents/${agentId}/calls?limit=50`),
          api.get<{ bookings: Booking[] }>(`/api/agents/${agentId}/bookings`)
        ]);
        setAnalytics(analyticsRes?.analytics ?? null);
        setEvents(analyticsRes?.events ?? []);
        const nextCalls = callsRes?.calls ?? [];
        setCalls(nextCalls);
        setBookings(bookingsRes?.bookings ?? []);
        setSelectedCallId(prev => (nextCalls.some(c => c.id === prev) ? prev : nextCalls[0]?.id ?? null));
        connectSse(agentId);
      } catch (err) {
        showToast("Failed to load agent data: " + (err as Error).message, "error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast]
  );

  const connectSse = useCallback(
    (agentId: string) => {
      closeSse();
      const token = getToken();
      if (!agentId || !token) return;

      const es = new EventSource(`${API_BASE}/api/agents/${agentId}/sse?token=${token}`);
      sseRef.current = es;

      es.addEventListener("connected", () => setSseConnected(true));

      const refreshData = async () => {
        const id = selectedAgentIdRef.current;
        if (!id) return;
        try {
          const [analyticsRes, bookingsRes] = await Promise.all([
            api.get<{ analytics: Analytics; events: AgentEvent[] }>(`/api/agents/${id}/analytics`),
            api.get<{ bookings: Booking[] }>(`/api/agents/${id}/bookings`)
          ]);
          if (analyticsRes?.analytics) setAnalytics(analyticsRes.analytics);
          if (analyticsRes?.events) setEvents(analyticsRes.events);
          if (bookingsRes?.bookings) setBookings(bookingsRes.bookings);
        } catch {
          /* ignore */
        }
      };

      es.addEventListener("call.ended", refreshData);
      es.addEventListener("booking.created", refreshData);
      es.addEventListener("booking.updated", refreshData);
      es.addEventListener("agent.updated", () => void loadAgents());
      es.addEventListener("agent.provisioned", () => void loadAgents());

      es.onerror = () => {
        sseRef.current = null;
        setSseConnected(false);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closeSse]
  );

  const loadAgents = useCallback(async () => {
    try {
      const data = await api.get<{ agents: Agent[] }>("/api/agents");
      if (!data) return;
      const list = data.agents || [];
      setAgents(list);

      if (list.length === 0) {
        setSelectedAgentId(null);
        return;
      }

      let current = selectedAgentIdRef.current;
      if (!list.find(a => a.id === current)) {
        current = list[0].id;
        setSelectedAgentId(current);
        localStorage.setItem(AGENT_KEY, current);
      }
      await loadAgentData(current!);
    } catch (err) {
      showToast("Failed to load agents: " + (err as Error).message, "error");
    }
  }, [loadAgentData, showToast]);

  const bootApp = useCallback(async () => {
    setScreen("app");
    api
      .get<AppConfig>("/api/info")
      .then(info => {
        if (info) setConfig(info);
      })
      .catch(() => {});
    await loadAgents();
  }, [loadAgents]);

  const finishAuth = useCallback(
    (token: string, u: User) => {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      setUser(u);
    },
    []
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<{ token: string; user: User }>("/api/auth/login", { email, password });
      if (!data) return;
      finishAuth(data.token, data.user);
      await bootApp();
    },
    [bootApp, finishAuth]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<{ token: string; user: User }>("/api/auth/register", { email, password });
      if (!data) return;
      finishAuth(data.token, data.user);
      await bootApp();
    },
    [bootApp, finishAuth]
  );

  // Boot on mount
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) {
        setScreen("auth");
        return;
      }
      setScreen("loading");
      try {
        const me = await api.get<{ user: User }>("/api/me");
        if (!me) return;
        setUser(me.user);
        await bootApp();
      } catch {
        logout();
      }
    })();
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectAgent = useCallback(
    async (id: string) => {
      setSelectedAgentId(id);
      localStorage.setItem(AGENT_KEY, id);
      await loadAgentData(id);
    },
    [loadAgentData]
  );

  const refresh = useCallback(async () => {
    const id = selectedAgentIdRef.current;
    if (!id) return;
    await loadAgentData(id);
    showToast("Data refreshed");
  }, [loadAgentData, showToast]);

  const replaceAgent = useCallback((updated: Agent) => {
    setAgents(prev => prev.map(a => (a.id === updated.id ? updated : a)));
  }, []);

  // Pause any other live agents (one-at-a-time enforcement).
  const pauseOtherLive = useCallback(async (exceptId: string) => {
    const liveAgents = agentsRef.current.filter(a => a.status === "live" && a.id !== exceptId);
    for (const la of liveAgents) {
      const stopRes = await api.post<{ agent: Agent }>(`/api/agents/${la.id}/stop`, {});
      if (stopRes?.agent) replaceAgent(stopRes.agent);
    }
  }, [replaceAgent]);

  const provisionAgent = useCallback(
    async (id: string) => {
      try {
        await pauseOtherLive(id);
        const res = await api.post<{ agent: Agent }>(`/api/agents/${id}/provision`, {});
        if (!res?.agent) throw new Error("Provision failed");
        showToast(`Live at ${res.agent.twilioPhoneNumber || "—"}`);
        await loadAgents();
      } catch (err) {
        showToast("Provision failed: " + (err as Error).message, "error");
      }
    },
    [loadAgents, pauseOtherLive, showToast]
  );

  const stopAgent = useCallback(
    async (id: string) => {
      try {
        const res = await api.post<{ agent: Agent }>(`/api/agents/${id}/stop`, {});
        if (!res?.agent) throw new Error("Stop failed");
        replaceAgent(res.agent);
        showToast(`${res.agent.name} stopped — paused`);
      } catch (err) {
        showToast("Stop failed: " + (err as Error).message, "error");
      }
    },
    [replaceAgent, showToast]
  );

  const resumeAgent = useCallback(
    async (id: string) => {
      try {
        await pauseOtherLive(id);
        const res = await api.post<{ agent: Agent }>(`/api/agents/${id}/resume`, {});
        if (!res?.agent) throw new Error("Resume failed");
        replaceAgent(res.agent);
        showToast(`${res.agent.name} resumed — ready for calls`);
      } catch (err) {
        showToast("Resume failed: " + (err as Error).message, "error");
      }
    },
    [pauseOtherLive, replaceAgent, showToast]
  );

  const savePrompt = useCallback(
    async (id: string, systemPrompt: string, voice?: string) => {
      const res = await api.put<{ agent: Agent }>(`/api/agents/${id}`, { systemPrompt, voice });
      if (!res?.agent) throw new Error("Update failed");
      replaceAgent(res.agent);
      showToast(`Prompt v${res.agent.promptVersion} deployed`);
    },
    [replaceAgent, showToast]
  );

  const updateBookingStatus = useCallback(
    async (bookingId: string, status: BookingStatus) => {
      const id = selectedAgentIdRef.current;
      if (!id) return;
      try {
        const res = await api.put<{ booking: Booking }>(`/api/agents/${id}/bookings/${bookingId}`, { status });
        if (!res?.booking) throw new Error("Update failed");
        setBookings(prev => prev.map(b => (b.id === bookingId ? res.booking : b)));
        showToast(`Booking marked ${status}`);
      } catch (err) {
        showToast("Failed: " + (err as Error).message, "error");
      }
    },
    [showToast]
  );

  const loadCallDetail = useCallback(async (callId: string) => {
    const id = selectedAgentIdRef.current;
    if (!id) return;
    setSelectedCallId(callId);
    try {
      const res = await api.get<{ call: Call }>(`/api/agents/${id}/calls/${callId}`);
      if (!res?.call) return;
      setCalls(prev => {
        const exists = prev.some(c => c.id === callId);
        return exists ? prev.map(c => (c.id === callId ? res.call : c)) : [res.call, ...prev];
      });
    } catch {
      /* ignore — already rendered from the list */
    }
  }, []);

  const createAgent = useCallback(
    async (input: CreateAgentInput, file?: File | null): Promise<Agent> => {
      const res = await api.post<{ agent: Agent }>("/api/agents", input);
      if (!res?.agent) throw new Error("No agent returned");
      const agent = res.agent;

      if (file) {
        const form = new FormData();
        form.append("file", file);
        try {
          await api.upload(`/api/agents/${agent.id}/knowledge`, form);
        } catch {
          showToast("Agent created but knowledge upload failed.", "warning");
        }
      }

      await loadAgents();
      setSelectedAgentId(agent.id);
      localStorage.setItem(AGENT_KEY, agent.id);
      await loadAgentData(agent.id);
      setView("dashboard");
      showToast(`${agent.name} created — status: ${agent.status}`);
      return agent;
    },
    [loadAgentData, loadAgents, showToast]
  );

  const generatePrompt = useCallback(async (input: GeneratePromptInput) => {
    const res = await api.post<{ systemPrompt: string; bookingEnabled: boolean }>("/api/agents/generate-prompt", input);
    if (!res?.systemPrompt) return null;
    return { systemPrompt: res.systemPrompt, bookingEnabled: res.bookingEnabled !== false };
  }, []);

  const testChat = useCallback(async (messages: ChatMessage[]) => {
    const id = selectedAgentIdRef.current;
    if (!id) throw new Error("No agent selected");
    const res = await api.post<{ reply: string; endCall: boolean }>(`/api/agents/${id}/chat`, { messages });
    return { reply: res?.reply || "Sorry, I didn't catch that.", endCall: Boolean(res?.endCall) };
  }, []);

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  // Tear down SSE on unmount.
  useEffect(() => () => closeSse(), [closeSse]);

  const value: Store = {
    user,
    agents,
    selectedAgentId,
    selectedAgent,
    calls,
    selectedCallId,
    bookings,
    analytics,
    events,
    config,
    screen,
    view,
    bookingFilter,
    sseConnected,
    toast,
    login,
    register,
    logout,
    setView,
    selectAgent,
    refresh,
    provisionAgent,
    stopAgent,
    resumeAgent,
    savePrompt,
    updateBookingStatus,
    setSelectedCallId,
    loadCallDetail,
    createAgent,
    generatePrompt,
    testChat,
    setBookingFilter,
    showToast
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
