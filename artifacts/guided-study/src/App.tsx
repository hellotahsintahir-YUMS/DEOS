import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetGoogleFileContentQueryKey,
  getGetGoogleStatusQueryKey,
  getGetStudyStatusQueryKey,
  getListGoogleFilesQueryKey,
  useDisconnectGoogle,
  useGetGoogleFileContent,
  useGetGoogleStatus,
  useGetStudyStatus,
  useListGoogleFiles,
  useSendStudyPrompt,
  useStartGoogleConnect,
  type GoogleFile,
  type StudyInput,
} from '@workspace/api-client-react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  GraduationCap,
  Lightbulb,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Paperclip,
  Plus,
  Presentation,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Link, Route, Switch } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
type ChatMessage = { role: 'user' | 'assistant'; content: string; coachingMove?: string };
type EducationLevel = StudyInput['educationLevel'];
const STORAGE_KEY = 'guided-study-conversation-v1';

const moveLabels: Record<string, string> = {
  question: 'A question to think through',
  hint: 'A small hint',
  reflection: 'A moment to reflect',
  encouragement: 'A little encouragement',
};

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" data-testid="link-brand">
          <span className="brand-mark"><Sparkles size={17} strokeWidth={1.8} /></span>
          <span>kindred<span className="brand-period">.</span><small>STUDY STUDIO</small></span>
        </Link>
        <div className="sidebar-note">
          <div className="note-orbit"><span /></div>
          <p>Learning is a conversation.</p>
          <span>Not a race to the answer.</span>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          <p className="nav-label">YOUR SPACE</p>
          <Link href="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} data-testid="link-study">
            <MessageCircle size={17} /> Guided study <span className="nav-dot" />
          </Link>
          <Link href="/sources" className={`nav-link ${location.pathname === '/sources' ? 'active' : ''}`} data-testid="link-sources">
            <BookOpen size={17} /> My sources
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-quote">“The beautiful thing about learning is that nobody can take it away from you.”<span>— B.B. King</span></div>
          <div className="privacy-pill"><span /> Your space, your pace</div>
        </div>
      </aside>
      <main className="main-area">{children}</main>
    </div>
  );
}

function Header({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {detail && <p className="header-detail">{detail}</p>}
      </div>
      <div className="header-avatar" aria-label="Your study space">S</div>
    </header>
  );
}

function StatusNotice({ status, isLoading, isError, onRetry }: {
  status?: { available: boolean; model: string; freeTierOnly: boolean; maxMessagesPerHour: number };
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return <div className="inline-status loading" data-testid="status-study-loading"><span className="skeleton-dot" /> Checking your study space…</div>;
  }
  if (isError) {
    return <div className="inline-status error" role="status" data-testid="status-study-error"><AlertCircle size={16} /> We couldn’t check study availability. <button onClick={onRetry} data-testid="button-retry-study">Try again</button></div>;
  }
  if (!status?.available) {
    return <div className="inline-status error" role="status" data-testid="status-study-unavailable"><AlertCircle size={16} /> Guided study is temporarily unavailable. Please try again later.</div>;
  }
  return (
    <div className="inline-status available" data-testid="status-study-available">
      <span className="status-pulse" /> Ready when you are
      <span className="status-divider" />
      <span className="status-model">{status.model || 'Study guide'}</span>
    </div>
  );
}

function SafetyNotice() {
  return (
    <div className="safety-notice" role="note" data-testid="notice-free-tier">
      <div className="safety-icon"><ShieldAlert size={17} /></div>
      <div><strong>A quick note before you share</strong><p>Google’s unpaid Gemini tier may use prompts and replies to improve its products, and people may review them. Please leave out personal or confidential information.</p></div>
    </div>
  );
}

function StudyPage() {
  const queryClient = useQueryClient();
  const statusQuery = useGetStudyStatus({ query: { queryKey: getGetStudyStatusQueryKey(), retry: false } });
  const sendPrompt = useSendStudyPrompt();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subject, setSubject] = useState('Biology');
  const [level, setLevel] = useState<EducationLevel>('high-school');
  const [draft, setDraft] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasMessages = messages.length > 0;
  const status = statusQuery.data;
  const canSend = !!draft.trim() && !sendPrompt.isPending && !statusQuery.isLoading && !statusQuery.isError && !!status?.available;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'));
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages, storageReady]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sendPrompt.isPending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !status?.available || sendPrompt.isPending || statusQuery.isLoading || statusQuery.isError) return;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setDraft('');
    sendPrompt.mutate({
      data: {
        messages: nextMessages.map(({ role, content: message }) => ({ role, content: message })),
        subject,
        educationLevel: level,
        ...(sourceText ? { sourceText } : {}),
      },
    }, {
      onSuccess: (reply) => setMessages((current) => [...current, { role: 'assistant', content: reply.reply, coachingMove: reply.coachingMove }]),
      onError: () => queryClient.invalidateQueries({ queryKey: getGetStudyStatusQueryKey() }),
    });
  };

  const clearChat = () => {
    setMessages([]);
    setSourceText('');
    setSourceTitle('');
    setDraft('');
  };

  const addPrompt = (prompt: string) => {
    setDraft(prompt);
    inputRef.current?.focus();
  };

  return (
    <div className="study-page">
      <Header eyebrow="A LITTLE HELP, RIGHT WHEN YOU NEED IT" title={hasMessages ? 'Let’s keep thinking.' : 'What are we figuring out?'} detail={hasMessages ? 'You bring the ideas. We’ll take them one step further.' : 'Bring a question, a half-formed thought, or a problem you’re stuck on.'} />
      <div className="study-controls">
        <label className="control-label">I’m working on
          <span className="select-wrap"><GraduationCap size={16} /><select value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="select-subject" aria-label="Study subject">
            {['Biology', 'Chemistry', 'Physics', 'Mathematics', 'History', 'Literature', 'Computer science', 'Economics', 'Other'].map((name) => <option key={name}>{name}</option>)}
          </select><ChevronDown size={14} /></span>
        </label>
        <label className="control-label">My level
          <span className="select-wrap level-select"><select value={level} onChange={(e) => setLevel(e.target.value as EducationLevel)} data-testid="select-level" aria-label="Education level">
            <option value="high-school">High school</option><option value="university">University</option><option value="other">Other</option>
          </select><ChevronDown size={14} /></span>
        </label>
        {hasMessages && <button className="text-button clear-button" onClick={clearChat} data-testid="button-new-conversation"><Plus size={15} /> New conversation</button>}
      </div>

      <StatusNotice status={status} isLoading={statusQuery.isLoading} isError={statusQuery.isError} onRetry={() => statusQuery.refetch()} />

      <section className={`conversation-panel ${hasMessages ? 'has-messages' : ''}`}>
        {!hasMessages ? (
          <div className="welcome-state">
            <div className="welcome-art" aria-hidden="true">
              <div className="art-circle circle-one" /><div className="art-circle circle-two" />
              <div className="book-stack"><span /><span /><span /></div><div className="spark-mark"><Sparkles size={17} /></div>
            </div>
            <p className="welcome-kicker">A thought is a good place to start.</p>
            <h2>Stuck is just a<br /><em>starting point.</em></h2>
            <p className="welcome-copy">I won’t hand you the answer. I’ll ask the kind of questions that help you find your way there.</p>
            <div className="suggestion-row">
              <button onClick={() => addPrompt('I’m stuck on a concept and I’m not sure what I’m missing.')} data-testid="button-suggestion-concept"><CircleHelp size={15} /> Explain a concept</button>
              <button onClick={() => addPrompt('Can you give me a small hint to get started?')} data-testid="button-suggestion-hint"><Lightbulb size={15} /> Give me a hint</button>
              <button onClick={() => addPrompt('Help me check my reasoning so far.')} data-testid="button-suggestion-reasoning"><MessageCircle size={15} /> Check my reasoning</button>
            </div>
          </div>
        ) : (
          <div className="message-stream" ref={scrollRef} aria-live="polite" data-testid="conversation-messages">
            <div className="conversation-date"><span /> TODAY’S STUDY SESSION <span /></div>
            {messages.map((message, index) => (
              <article className={`message-row ${message.role}`} key={`${index}-${message.role}`} data-testid={`message-${message.role}-${index}`}>
                {message.role === 'assistant' && <div className="guide-avatar"><Sparkles size={15} /></div>}
                <div className="message-content">
                  {message.role === 'assistant' && <div className="message-byline">Kindred guide {message.coachingMove && <span>{moveLabels[message.coachingMove] || message.coachingMove}</span>}</div>}
                  <div className="message-bubble">{message.content}</div>
                </div>
                {message.role === 'user' && <div className="student-avatar">S</div>}
              </article>
            ))}
            {sendPrompt.isPending && <div className="message-row assistant"><div className="guide-avatar"><Sparkles size={15} /></div><div className="message-content"><div className="message-byline">Kindred guide <span>Thinking it through</span></div><div className="message-bubble typing-bubble"><i /><i /><i /></div></div></div>}
            {sendPrompt.isError && <div className="chat-error" role="alert" data-testid="status-send-error"><AlertCircle size={16} /><span>That didn’t go through. Your message is still here—please try again.</span><button onClick={() => {
              const last = messages[messages.length - 1];
              if (last?.role === 'user') {
                const retryMessages = messages.slice(0, -1);
                setMessages(retryMessages);
                setDraft(last.content);
              }
            }} data-testid="button-retry-message">Try again</button></div>}
          </div>
        )}
      </section>

      {sourceTitle && <div className="attached-source" data-testid="status-attached-source"><FileText size={15} /><span>Using <strong>{sourceTitle}</strong> as study context</span><button onClick={() => { setSourceTitle(''); setSourceText(''); }} aria-label="Remove source" data-testid="button-remove-source"><X size={15} /></button></div>}
      <SafetyNotice />
      {!statusQuery.isError && status?.available && status.maxMessagesPerHour > 0 && <div className="quota-hint" data-testid="text-hourly-limit"><Clock3 size={13} /> Up to {status.maxMessagesPerHour} guided messages per hour</div>}
      <form className="composer" onSubmit={submit}>
        <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) submit(e); } }} placeholder="Tell me what you’re working through…" maxLength={6000} rows={2} aria-label="Your study question" data-testid="input-study-message" />
        <div className="composer-footer">
          <div className="composer-left">
            <Link href="/sources" className="attach-button" data-testid="link-attach-source"><Paperclip size={15} /><span>Add a source</span></Link>
            <span className="key-hint">↵ to send · shift + ↵ for a new line</span>
          </div>
          <button className="send-button" type="submit" disabled={!canSend} data-testid="button-send-message"><span>{sendPrompt.isPending ? 'Thinking' : 'Send'}</span>{sendPrompt.isPending ? <LoaderCircle size={16} className="spin" /> : <Send size={15} />}</button>
        </div>
      </form>
      <p className="under-composer">Your work stays yours. Kindred helps you think, not copy.</p>
    </div>
  );
}

function FileCard({ file, onUse }: { file: GoogleFile; onUse: (file: GoogleFile) => void }) {
  const Icon = file.kind === 'slides' ? Presentation : FileText;
  const dateLabel = file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable';
  return (
    <article className="file-card" data-testid={`card-google-file-${file.id}`}>
      <div className={`file-icon ${file.kind}`}><Icon size={18} /></div>
      <div className="file-detail"><h3>{file.name}</h3><p>{file.kind === 'slides' ? 'Google Slides' : 'Google Doc'} <span>·</span> Updated {dateLabel}</p></div>
      <button className="file-use-button" onClick={() => onUse(file)} data-testid={`button-use-file-${file.id}`}>Study this <ArrowRight size={14} /></button>
      <a className="file-open-link" href={file.url} target="_blank" rel="noreferrer" aria-label={`Open ${file.name} in Google Drive`} data-testid={`link-open-file-${file.id}`}><ArrowRight size={15} /></a>
    </article>
  );
}

function SourcesPage() {
  const queryClient = useQueryClient();
  const statusQuery = useGetGoogleStatus({ query: { queryKey: getGetGoogleStatusQueryKey(), retry: false } });
  const googleStatus = statusQuery.data;
  const filesQuery = useListGoogleFiles({ query: { queryKey: getListGoogleFilesQueryKey(), enabled: !!googleStatus?.configured && !!googleStatus.connected, retry: false } });
  const startConnect = useStartGoogleConnect();
  const disconnect = useDisconnectGoogle();
  const [selectedId, setSelectedId] = useState('');
  const [selectedTitle, setSelectedTitle] = useState('');
  const fileContentQuery = useGetGoogleFileContent(selectedId, { query: { queryKey: getGetGoogleFileContentQueryKey(selectedId), enabled: !!selectedId, retry: false } });
  const [connectError, setConnectError] = useState('');
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const onUseFile = (file: GoogleFile) => {
    setSelectedId(file.id);
    setSelectedTitle(file.name);
  };

  useEffect(() => {
    if (fileContentQuery.data?.text) {
      sessionStorage.setItem('guided-study-source', JSON.stringify({ title: fileContentQuery.data.title, text: fileContentQuery.data.text }));
      window.location.href = '/';
    }
  }, [fileContentQuery.data]);

  const connect = () => {
    setConnectError('');
    startConnect.mutate(undefined, {
      onSuccess: (result) => {
        if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
        else setConnectError('Google authorization did not return a link. Please try again.');
      },
      onError: () => setConnectError('We couldn’t start Google authorization. Please try again in a moment.'),
    });
  };

  const disconnectAccount = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setDisconnectConfirm(false);
        queryClient.invalidateQueries({ queryKey: getGetGoogleStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListGoogleFilesQueryKey() });
      },
    });
  };

  const files = filesQuery.data ?? [];

  return (
    <div className="sources-page">
      <Header eyebrow="YOUR MATERIAL, YOUR TERMS" title="Bring your notes along." detail="Connect your own Google account to study from your Docs and Slides." />
      <div className="source-intro">
        <div className="source-intro-mark"><BookOpen size={22} /></div>
        <div><h2>Make your own work the starting point.</h2><p>Choose a note or lecture deck, and Kindred will use its text to keep your study session grounded in what you’re learning.</p></div>
      </div>

      <section className="connection-card" aria-labelledby="connection-heading">
        <div className="connection-heading">
          <div className="google-g-mark">G</div>
          <div><p className="eyebrow">PERSONAL CONNECTION</p><h2 id="connection-heading">Your Google Drive</h2></div>
          {statusQuery.isLoading && <span className="connection-badge pending"><span className="skeleton-dot" /> Checking</span>}
          {statusQuery.data?.connected && <span className="connection-badge connected"><CheckCircle2 size={14} /> Connected</span>}
        </div>

        {statusQuery.isLoading && <div className="connection-loading" data-testid="status-google-loading"><div className="skeleton-line" /><div className="skeleton-line short" /></div>}
        {statusQuery.isError && <div className="state-message error" role="alert" data-testid="status-google-error"><AlertCircle size={18} /><div><strong>Couldn’t check your connection</strong><p>Please try again to see your Google Drive status.</p><button className="text-button" onClick={() => statusQuery.refetch()} data-testid="button-retry-google-status"><RefreshCw size={14} /> Try again</button></div></div>}
        {!statusQuery.isLoading && !statusQuery.isError && googleStatus && !googleStatus.configured && <div className="state-message warning" data-testid="status-google-unconfigured"><AlertCircle size={18} /><div><strong>Google Drive isn’t set up yet</strong><p>{googleStatus.message || 'Google connection is not configured for this study space.'} This needs to be enabled before you can connect a personal account.</p></div></div>}
        {!statusQuery.isLoading && !statusQuery.isError && googleStatus?.configured && !googleStatus.connected && <div className="connect-content" data-testid="status-google-disconnected">
          <p>Connect the Google account that belongs to you. Your Drive is private to your student connection—there is no shared owner account.</p>
          {googleStatus.message && <p className="connection-message">{googleStatus.message}</p>}
          {connectError && <p className="inline-error" role="alert" data-testid="status-google-connect-error"><AlertCircle size={14} />{connectError}</p>}
          <button className="primary-button" onClick={connect} disabled={startConnect.isPending} data-testid="button-connect-google">{startConnect.isPending ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{startConnect.isPending ? 'Connecting…' : 'Connect my Google Drive'}</button>
          <p className="small-privacy"><ShieldAlert size={13} /> Only connect your own account. You can disconnect it at any time.</p>
        </div>}
        {!statusQuery.isLoading && !statusQuery.isError && googleStatus?.configured && googleStatus.connected && <div className="connected-content" data-testid="status-google-connected">
          <div className="connected-account"><div className="account-check"><Check size={14} /></div><div><strong>{googleStatus.email || 'Google account connected'}</strong><span>Only you can access this connection</span></div></div>
          <div className="disconnect-area">
            {!disconnectConfirm ? <button className="text-button disconnect-button" onClick={() => setDisconnectConfirm(true)} data-testid="button-disconnect-google"><LogOut size={14} /> Disconnect</button> : <div className="confirm-inline"><span>Disconnect your Google Drive?</span><button onClick={disconnectAccount} disabled={disconnect.isPending} data-testid="button-confirm-disconnect">{disconnect.isPending ? 'Disconnecting…' : 'Yes, disconnect'}</button><button onClick={() => setDisconnectConfirm(false)} data-testid="button-cancel-disconnect">Keep connected</button></div>}
            {disconnect.isError && <p className="inline-error" role="alert" data-testid="status-google-disconnect-error"><AlertCircle size={14} />Could not disconnect. Please try again.</p>}
          </div>
        </div>}
      </section>

      {googleStatus?.configured && googleStatus.connected && <section className="files-section">
        <div className="files-heading"><div><p className="eyebrow">AVAILABLE TO YOU</p><h2>Your Docs &amp; Slides</h2></div><span className="file-count">{filesQuery.isSuccess ? `${files.length} ${files.length === 1 ? 'file' : 'files'}` : 'Your Drive'}</span></div>
        <p className="files-intro">Pick something you made or have permission to study. We’ll bring its text into your session.</p>
        {filesQuery.isLoading && <div className="file-list-skeleton" data-testid="status-files-loading">{[1, 2, 3].map((n) => <div className="file-skeleton" key={n}><span /><div><i /><i /></div></div>)}</div>}
        {filesQuery.isError && <div className="state-message error files-error" role="alert" data-testid="status-files-error"><AlertCircle size={18} /><div><strong>Couldn’t load your files</strong><p>Your Google connection is still active. Try loading your Docs and Slides again.</p><button className="text-button" onClick={() => filesQuery.refetch()} data-testid="button-retry-files"><RefreshCw size={14} /> Try again</button></div></div>}
        {!filesQuery.isLoading && !filesQuery.isError && files.length === 0 && <div className="empty-files" data-testid="status-files-empty"><div className="empty-file-art"><FileText size={21} /><span><Presentation size={18} /></span></div><h3>No study files found</h3><p>Docs and Slides available to this Google account will appear here.</p></div>}
        {files.length > 0 && <div className="file-list">{files.map((file) => <FileCard key={file.id} file={file} onUse={onUseFile} />)}</div>}
        {fileContentQuery.isLoading && <div className="loading-file" role="status" data-testid="status-file-content-loading"><LoaderCircle size={16} className="spin" /> Opening {selectedTitle}…</div>}
        {fileContentQuery.isError && <div className="inline-error file-content-error" role="alert" data-testid="status-file-content-error"><AlertCircle size={15} />Couldn’t read that file. Check your access and try again.<button onClick={() => fileContentQuery.refetch()} data-testid="button-retry-file-content">Try again</button><button onClick={() => setSelectedId('')} aria-label="Dismiss file error"><X size={14} /></button></div>}
      </section>}
      <div className="sources-footer"><div className="footer-line" /><p><ShieldAlert size={14} /> Don’t use personal or confidential information in study prompts. Google’s unpaid Gemini tier may use prompts and replies to improve products and may involve human review.</p><Link href="/" className="back-study-link" data-testid="link-back-to-study"><ArrowLeft size={14} /> Back to study</Link></div>
    </div>
  );
}

function Router() {
  return <Switch><Route path="/" component={StudyPage} /><Route path="/sources" component={SourcesPage} /><Route component={NotFound} /></Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><AppShell><Router /></AppShell></QueryClientProvider>;
}

export default App;
