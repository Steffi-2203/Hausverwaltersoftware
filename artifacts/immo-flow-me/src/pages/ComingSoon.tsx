import { MainLayout } from '@/components/layout/MainLayout';
import { Construction } from 'lucide-react';

interface ComingSoonProps {
  title: string;
  subtitle?: string;
}

export default function ComingSoon({ title, subtitle }: ComingSoonProps) {
  return (
    <MainLayout title={title} subtitle={subtitle}>
      <div className="flex flex-col items-center justify-center py-24">
        <div className="rounded-full bg-primary/10 p-6 mb-6">
          <Construction className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">In Entwicklung</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Diese Funktion wird derzeit entwickelt und ist bald verfügbar. 
          Schauen Sie regelmäßig vorbei für Updates.
        </p>
      </div>
    </MainLayout>
  );
}
