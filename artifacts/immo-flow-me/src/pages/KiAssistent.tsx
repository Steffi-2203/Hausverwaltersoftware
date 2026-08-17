import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Sparkles, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useKiAutopilot } from '@/hooks/useKiAutopilot';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const exampleChips = [
  'Offene Posten zeigen',
  'Welche Mieter sind im Rückstand?',
  'BK-Status prüfen',
  'Mietrecht-Frage stellen',
  'Leerstand analysieren',
];

export default function KiAssistent() {
  const { isActive, isLoading: kiLoading } = useKiAutopilot();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (kiLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>KI-Autopilot erforderlich</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Der KI-Assistent ist Teil des KI-Autopilot Add-ons. Aktivieren Sie das Add-on, um diese Funktion zu nutzen.
            </p>
            <Link to="/checkout?plan=ki-autopilot">
              <Button data-testid="button-upgrade-ki">
                <Sparkles className="mr-2 h-4 w-4" />
                KI-Autopilot aktivieren
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const response = await fetch('/api/ki/chat', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ message: text.trim() }),
      });

      if (!response.ok) throw new Error('Anfrage fehlgeschlagen');

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.' }]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Bot className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-ki-assistent-title">KI-Assistent</h1>
          <Badge variant="secondary">Beta</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Ihr persönlicher Assistent für die Hausverwaltung
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-medium mb-2">Wie kann ich Ihnen helfen?</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Stellen Sie mir Fragen zu Ihren Liegenschaften, Mietern, Zahlungen oder zum österreichischen Mietrecht.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {exampleChips.map(chip => (
                <Button
                  key={chip}
                  variant="outline"
                  size="sm"
                  onClick={() => sendMessage(chip)}
                  data-testid={`chip-${chip.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  {chip}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
              data-testid={`message-${msg.role}-${i}`}
            >
              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ihre Frage eingeben..."
            disabled={sending}
            data-testid="input-ki-message"
            className="flex-1"
          />
          <Button type="submit" disabled={sending || !input.trim()} data-testid="button-send-message">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
