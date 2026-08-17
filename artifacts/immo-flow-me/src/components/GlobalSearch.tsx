import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Building2, DoorOpen, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";

interface SearchResult {
  type: "property" | "unit" | "tenant";
  id: string;
  propertyId?: string;
  label: string;
  sublabel: string;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
}

function useDebounce(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

const typeConfig = {
  property: {
    label: "Objekte",
    icon: Building2,
    getUrl: (id: string, _propertyId?: string) => `/liegenschaften/${id}`,
  },
  unit: {
    label: "Einheiten",
    icon: DoorOpen,
    getUrl: (id: string, propertyId?: string) => `/einheiten/${propertyId || id}/${id}`,
  },
  tenant: {
    label: "Mieter",
    icon: Users,
    getUrl: (id: string, _propertyId?: string) => `/mieter/${id}`,
  },
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 1) {
        return { results: [] };
      }
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}&type=all`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedQuery.length >= 1,
    staleTime: 1000 * 30,
  });

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setOpen(false);
      setQuery("");
      const config = typeConfig[result.type];
      if (config) {
        navigate(config.getUrl(result.id, result.propertyId));
      }
    },
    [navigate]
  );

  const results = data?.results || [];
  const properties = results.filter((r) => r.type === "property");
  const units = results.filter((r) => r.type === "unit");
  const tenants = results.filter((r) => r.type === "tenant");

  return (
    <>
      <Button
        variant="outline"
        className="relative w-40 md:w-64 justify-start gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid="button-global-search"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline-flex">Suche...</span>
        <span className="inline-flex md:hidden">Suche</span>
        <kbd className="pointer-events-none absolute right-2 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 md:flex">
          <span className="text-xs">Ctrl</span>K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Suche nach Objekten, Einheiten, Mietern..."
          value={query}
          onValueChange={setQuery}
          data-testid="input-global-search"
        />
        <CommandList data-testid="list-search-results">
          {isLoading && debouncedQuery.length >= 1 && (
            <div className="flex items-center justify-center py-6" data-testid="search-loading">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Suche...</span>
            </div>
          )}

          {!isLoading && debouncedQuery.length >= 1 && results.length === 0 && (
            <CommandEmpty data-testid="search-no-results">Keine Ergebnisse</CommandEmpty>
          )}

          {properties.length > 0 && (
            <CommandGroup heading="Objekte" data-testid="search-group-properties">
              {properties.map((result) => (
                <CommandItem
                  key={`property-${result.id}`}
                  value={`property-${result.id}-${result.label}`}
                  onSelect={() => handleSelect(result)}
                  data-testid={`search-result-property-${result.id}`}
                >
                  <Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm">{result.label}</span>
                    <span className="text-xs text-muted-foreground">{result.sublabel}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {properties.length > 0 && (units.length > 0 || tenants.length > 0) && (
            <CommandSeparator />
          )}

          {units.length > 0 && (
            <CommandGroup heading="Einheiten" data-testid="search-group-units">
              {units.map((result) => (
                <CommandItem
                  key={`unit-${result.id}`}
                  value={`unit-${result.id}-${result.label}`}
                  onSelect={() => handleSelect(result)}
                  data-testid={`search-result-unit-${result.id}`}
                >
                  <DoorOpen className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm">{result.label}</span>
                    <span className="text-xs text-muted-foreground">{result.sublabel}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {units.length > 0 && tenants.length > 0 && <CommandSeparator />}

          {tenants.length > 0 && (
            <CommandGroup heading="Mieter" data-testid="search-group-tenants">
              {tenants.map((result) => (
                <CommandItem
                  key={`tenant-${result.id}`}
                  value={`tenant-${result.id}-${result.label}`}
                  onSelect={() => handleSelect(result)}
                  data-testid={`search-result-tenant-${result.id}`}
                >
                  <Users className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm">{result.label}</span>
                    <span className="text-xs text-muted-foreground">{result.sublabel}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
