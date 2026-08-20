import React, { useEffect, useRef, useState } from 'react';
import { correctionQueue } from '@/utils/pendingCorrections';
import { saveCorrection, type UploadFn } from '@/utils/saveCorrection';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

// ── Confidence helpers ────────────────────────────────────────────────────────

type ConfidenceLevel = 'high' | 'medium' | 'low';

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return 'high';
  if (score >= 0.60) return 'medium';
  return 'low';
}

function getConfidenceColor(level: ConfidenceLevel): string {
  if (level === 'high')   return '#16A34A';
  if (level === 'medium') return '#D97706';
  return '#DC2626';
}

function getConfidenceLabel(level: ConfidenceLevel): string {
  if (level === 'high')   return 'Hoch';
  if (level === 'medium') return 'Mittel';
  return 'Niedrig';
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  lieferant:       string;
  betrag:          string;
  datum:           string;
  rechnungsnummer: string;
  kategorie:       string;
  expense_type:    string;
  beschreibung:    string;
}

interface PropertyOption {
  id: string;
  name?: string | null;
  address?: string | null;
  city?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentScan, setCurrentScan, apiRequest, user, refreshPendingCount } = useAuth();

  const [saving, setSaving] = useState(false);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [loadingProperties, setLoadingProperties] = useState(true);

  // Guard: no scan → go back
  useEffect(() => {
    if (!currentScan) router.back();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiRequest('/api/properties');
        const payload = await response.json().catch(() => []);
        if (active && response.ok) {
          setProperties(Array.isArray(payload) ? payload : payload.data ?? []);
        }
      } finally {
        if (active) setLoadingProperties(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const data = currentScan?.data;
  const validierung = data?.validierung;
  const confidenceScore = validierung?.confidence_score ?? 0;
  const confidenceLevel = getConfidenceLevel(confidenceScore);
  const confidenceColor = getConfidenceColor(confidenceLevel);
  const needsReview     = currentScan?.needs_review ?? false;
  const unsichere       = new Set(validierung?.unsichere_felder ?? []);
  const warnungen       = validierung?.warnungen ?? [];
  const fehler          = validierung?.fehler    ?? [];

  // Pre-fill form from OCR result
  const [form, setForm] = useState<FormState>({
    lieferant:       String(data?.lieferant       ?? ''),
    betrag:          String(data?.betrag           ?? ''),
    datum:           String(data?.datum            ?? ''),
    rechnungsnummer: String(data?.rechnungsnummer  ?? ''),
    kategorie:       String(data?.kategorie        ?? ''),
    expense_type:    String(data?.expense_type     ?? ''),
    beschreibung:    String(data?.beschreibung     ?? ''),
  });

  function setField(key: keyof FormState, val: string) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  function isUnsicher(field: string): boolean {
    return unsichere.has(field);
  }

  async function handleSave() {
    setSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      // Build corrections: compare original vs current form values
      const original = {
        lieferant:       String(data?.lieferant       ?? ''),
        betrag:          String(data?.betrag           ?? ''),
        datum:           String(data?.datum            ?? ''),
        rechnungsnummer: String(data?.rechnungsnummer  ?? ''),
        kategorie:       String(data?.kategorie        ?? ''),
        expense_type:    String(data?.expense_type     ?? ''),
        beschreibung:    String(data?.beschreibung     ?? ''),
        confidence_score: confidenceScore,
      };

      const corrections: Record<string, { vorher: string; nachher: string }> = {};
      const fields: (keyof Omit<typeof original, 'confidence_score'>)[] = [
        'lieferant', 'betrag', 'datum', 'rechnungsnummer', 'kategorie', 'expense_type', 'beschreibung',
      ];
      for (const f of fields) {
        if (original[f] !== form[f as keyof FormState]) {
          corrections[f] = { vorher: original[f], nachher: form[f as keyof FormState] };
        }
      }

      const hasChanges = Object.keys(corrections).length > 0;

      if (hasChanges) {
        const payload = {
          originalData:  original,
          correctedData: { ...form, corrections },
          source:        'mobile_ocr',
          fileName:      currentScan?.fileName ?? 'mobile_scan',
        };

        // ── Durable-outbox save via saveCorrection ──────────────────────────
        // Enqueues BEFORE the network attempt — survives process kill.
        // Returns { outcome, retryable } so we can show the right message.
        const upload: UploadFn = (p, signal) =>
          apiRequest('/api/ocr/corrections', { method: 'POST', body: JSON.stringify(p), signal });

        const saveResult = await saveCorrection(payload, {
          queue:  correctionQueue,
          upload,
          userId: user?.id ?? 'unknown',
        });

        if (saveResult.outcome === 'queued') {
          // Update the scan-screen badge immediately so the manager sees the
          // queued item as soon as they are returned to the scan screen.
          refreshPendingCount();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert(
            'Offline gespeichert',
            saveResult.retryable
              ? 'Der Server ist vorübergehend nicht erreichbar. Die Korrekturen wurden lokal gespeichert ' +
                'und werden automatisch nachgesendet sobald der Dienst wieder verfügbar ist.'
              : 'Die Korrekturen konnten gerade nicht übertragen werden und wurden lokal gespeichert. ' +
                'Beim nächsten App-Start werden sie automatisch nachgesendet.',
          );
          setCurrentScan(null);
          router.back();
          return;
        }

        if (saveResult.outcome === 'uploaded') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }

      if (!propertyId) {
        Alert.alert('Liegenschaft erforderlich', 'Bitte wählen Sie die Liegenschaft, der diese Eingangsrechnung zugeordnet werden soll.');
        return;
      }

      const transferResponse = await apiRequest('/api/ocr/invoice-transfer', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          propertyId,
          ocrDocumentId: currentScan?.ocrDocumentId ?? currentScan?.fileName,
          nettobetrag: data?.netto_betrag,
          ustBetrag: data?.ust_betrag,
          ustSatz: data?.ust_satz,
          source: 'mobile_ocr',
          originalData: original,
        }),
      });
      const transfer = await transferResponse.json().catch(() => ({}));
      if (!transferResponse.ok) {
        throw new Error(transfer.error ?? 'Die Rechnung konnte nicht in die Buchhaltung übernommen werden.');
      }

      setCurrentScan(null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        transfer.alreadyTransferred ? 'Bereits übernommen' : 'In Buchhaltung übernommen',
        transfer.alreadyTransferred
          ? 'Dieser OCR-Vorgang war bereits als Eingangsrechnung, Buchung und Kostenposition gespeichert.'
          : 'Eingangsrechnung, Journalsatz und Kostenposition wurden erfolgreich gespeichert.',
      );
      router.back();
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Fehler', err?.message ?? 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    setCurrentScan(null);
    router.back();
  }

  const styles = makeStyles(colors, insets);

  if (!currentScan) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Confidence badge ──────────────────────────── */}
        <View style={[styles.confidenceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.confidenceRow}>
            <View style={[styles.confidenceDot, { backgroundColor: confidenceColor }]} />
            <Text style={[styles.confidenceLabel, { color: colors.foreground }]}>
              Konfidenz: <Text style={{ color: confidenceColor, fontFamily: 'Inter_700Bold' }}>
                {getConfidenceLabel(confidenceLevel)}
              </Text>
            </Text>
            <Text style={[styles.confidenceScore, { color: confidenceColor }]}>
              {Math.round(confidenceScore * 100)}%
            </Text>
          </View>
          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { width: `${Math.round(confidenceScore * 100)}%` as any, backgroundColor: confidenceColor }]} />
          </View>
          {needsReview && (
            <View style={[styles.reviewBanner, { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }]}>
              <Ionicons name="warning-outline" size={16} color="#D97706" />
              <Text style={styles.reviewBannerText}>
                Prüfung empfohlen — bitte Felder kontrollieren und ggf. korrigieren.
              </Text>
            </View>
          )}
        </View>

        {/* ── Warnungen & Fehler ────────────────────────── */}
        {(warnungen.length > 0 || fehler.length > 0) && (
          <View style={[styles.warningsCard, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
            {fehler.map((f, i) => (
              <View key={`e${i}`} style={styles.warningRow}>
                <Feather name="alert-circle" size={14} color="#DC2626" />
                <Text style={[styles.warningText, { color: '#DC2626' }]}>{f}</Text>
              </View>
            ))}
            {warnungen.map((w, i) => (
              <View key={`w${i}`} style={styles.warningRow}>
                <Feather name="alert-triangle" size={14} color="#D97706" />
                <Text style={[styles.warningText, { color: '#92400E' }]}>{w}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Extracted fields (editable) ───────────────── */}
        <View style={[styles.fieldsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Extrahierte Daten</Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
            {needsReview
              ? 'Felder bitte prüfen und bei Bedarf korrigieren:'
              : 'Felder bei Bedarf korrigieren:'}
          </Text>

          <Field label="Lieferant"        value={form.lieferant}       onChange={v => setField('lieferant', v)}
                 uncertain={isUnsicher('lieferant')}       colors={colors} />
          <Field label="Bruttobetrag (€)"  value={form.betrag}          onChange={v => setField('betrag', v)}
                 uncertain={isUnsicher('betrag')}           colors={colors} keyboardType="decimal-pad" />
          <Field label="Datum"             value={form.datum}           onChange={v => setField('datum', v)}
                 uncertain={isUnsicher('datum')}            colors={colors} placeholder="TT.MM.JJJJ" />
          <Field label="Rechnungs-Nr."     value={form.rechnungsnummer} onChange={v => setField('rechnungsnummer', v)}
                 uncertain={isUnsicher('rechnungsnummer')}  colors={colors} />
          <Field label="Kategorie"         value={form.kategorie}       onChange={v => setField('kategorie', v)}
                 uncertain={isUnsicher('kategorie')}        colors={colors} />
          <Field label="Art"               value={form.expense_type}    onChange={v => setField('expense_type', v)}
                 uncertain={isUnsicher('expense_type')}     colors={colors} />
          <Field label="Beschreibung"      value={form.beschreibung}    onChange={v => setField('beschreibung', v)}
                 uncertain={isUnsicher('beschreibung')}     colors={colors} multiline />

          <View style={fieldStyles.wrapper}>
            <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>Liegenschaft für Buchhaltung</Text>
            {loadingProperties ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : properties.length === 0 ? (
              <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>Keine Liegenschaft verfügbar.</Text>
            ) : (
              <View style={styles.propertyChoices}>
                {properties.map(property => {
                  const selected = property.id === propertyId;
                  return (
                    <Pressable
                      key={property.id}
                      onPress={() => setPropertyId(property.id)}
                      style={[styles.propertyChoice, {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? `${colors.primary}18` : colors.input,
                      }]}
                    >
                      <Feather name={selected ? 'check-circle' : 'circle'} size={16} color={selected ? colors.primary : colors.mutedForeground} />
                      <Text style={[styles.propertyChoiceText, { color: colors.foreground }]}>
                        {property.name || property.address || 'Liegenschaft'}{property.city ? `, ${property.city}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* ── Actions ───────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.primary, opacity: pressed || saving ? 0.8 : 1 },
          ]}
          onPress={handleSave}
          disabled={saving}
          testID="btn-save"
        >
          {saving
            ? <ActivityIndicator color="#FFFFFF" />
            : <>
                <Feather name="check-circle" size={18} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Prüfen & in Buchhaltung übernehmen</Text>
              </>
          }
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={handleSkip}
          disabled={saving}
          testID="btn-skip"
        >
          <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
            Ohne Korrektur fortfahren
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ── Field component ───────────────────────────────────────────────────────────

function Field({
  label, value, onChange, uncertain, colors, multiline = false, keyboardType, placeholder,
}: {
  label:        string;
  value:        string;
  onChange:     (v: string) => void;
  uncertain:    boolean;
  colors:       ReturnType<typeof useColors>;
  multiline?:   boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'email-address';
  placeholder?: string;
}) {
  const borderColor = uncertain
    ? '#F59E0B'
    : colors.border;
  const bgColor = uncertain
    ? '#FFFBEB'
    : colors.input;

  return (
    <View style={fieldStyles.wrapper}>
      <View style={fieldStyles.labelRow}>
        <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
        {uncertain && (
          <View style={fieldStyles.badge}>
            <Ionicons name="alert-circle" size={12} color="#D97706" />
            <Text style={fieldStyles.badgeText}>unsicher</Text>
          </View>
        )}
      </View>
      <TextInput
        style={[
          fieldStyles.input,
          {
            borderColor,
            backgroundColor: bgColor,
            color: colors.foreground,
            textAlignVertical: multiline ? 'top' : 'center',
            minHeight: multiline ? 72 : 44,
          },
        ]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType ?? 'default'}
        placeholder={placeholder ?? '—'}
        placeholderTextColor={colors.mutedForeground}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrapper:    { marginBottom: 14 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  label:      { fontSize: 13, fontFamily: 'Inter_500Medium' },
  badge:      { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF3C7', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText:  { fontSize: 11, color: '#D97706', fontFamily: 'Inter_500Medium' },
  input:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: 'Inter_400Regular' },
});

// ── Screen styles ─────────────────────────────────────────────────────────────

const makeStyles = (colors: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    root: { flex: 1 },
    scroll: {
      padding: 16,
      paddingTop: Platform.OS === 'web' ? 67 : 16,
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24),
      gap: 12,
    },
    confidenceCard: {
      borderRadius: 12,
      borderWidth: 1,
      padding: 16,
    },
    confidenceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    confidenceDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    confidenceLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
    },
    confidenceScore: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
    },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      height: 6,
      borderRadius: 3,
    },
    reviewBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 12,
      borderRadius: 8,
      borderWidth: 1,
      padding: 10,
    },
    reviewBannerText: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: '#92400E',
      lineHeight: 18,
    },
    warningsCard: {
      borderRadius: 12,
      borderWidth: 1,
      padding: 12,
      gap: 6,
    },
    warningRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    warningText: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      lineHeight: 18,
    },
    fieldsCard: {
      borderRadius: 12,
      borderWidth: 1,
      padding: 16,
    },
    sectionTitle: {
      fontSize: 17,
      fontFamily: 'Inter_600SemiBold',
      marginBottom: 4,
    },
    sectionSub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      marginBottom: 16,
    },
    primaryBtn: {
      borderRadius: 12,
      paddingVertical: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
    },
    secondaryBtn: {
      paddingVertical: 12,
      alignItems: 'center',
    },
    secondaryBtnText: {
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
    },
    propertyChoices: { gap: 8, marginTop: 8 },
    propertyChoice: {
      minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12,
      paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    propertyChoiceText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  });
