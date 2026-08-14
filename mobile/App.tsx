import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Vibration,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { colors, money, tabular, type as typeScale } from './src/theme';
import type { Merchant, ParsedReceipt, Receipt } from './src/types';
import {
  deleteReceipt,
  fetchMerchants,
  fetchReceipts,
  fetchSummary,
  parseReceipt,
} from './src/api';

const SHEET_OFFSCREEN = 1200;
const SWIPE_WIDTH = 92;

const tabularText = (size: number, weight: '400' | '500' | '600', color: string, extra: object = {}) => ({
  fontSize: size,
  fontWeight: weight,
  color,
  ...tabular,
  ...extra,
});

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Ledger />
    </SafeAreaProvider>
  );
}

function Ledger() {
  const insets = useSafeAreaInsets();

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [merchantMap, setMerchantMap] = useState<Record<string, Merchant>>({});
  const [summary, setSummary] = useState<{ count: number; total: Record<string, number>; by_merchant: Record<string, { count: number; total: Record<string, number> }> }>({
    count: 0,
    total: {},
    by_merchant: {},
  });

  const [filterKey, setFilterKey] = useState('all');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [hiddenBalance, setHiddenBalance] = useState(false);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRec, setDetailRec] = useState<Receipt | null>(null);

  const [uploadVisible, setUploadVisible] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parseNote, setParseNote] = useState('');

  const [openSwipeId, setOpenSwipeId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [r, s] = await Promise.all([fetchReceipts(), fetchSummary()]);
    setReceipts(r);
    setSummary(s.summary);
  }, []);

  const loadMerchants = useCallback(async () => {
    try {
      const { merchants } = await fetchMerchants();
      setMerchantMap(Object.fromEntries(merchants.map((m) => [m.key, m])));
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    loadMerchants();
  }, [refresh, loadMerchants]);

  /* ---------- derived ---------- */
  const shown = useMemo(
    () => receipts.filter((r) => filterKey === 'all' || (r.merchant || 'other') === filterKey),
    [receipts, filterKey]
  );

  const pillKeys = useMemo(() => {
    const by = summary.by_merchant || {};
    return Object.keys(by).sort((a, b) => by[b].count - by[a].count);
  }, [summary]);

  const cur = useMemo(() => Object.keys(summary.total || {})[0] || 'EUR', [summary]);
  const spent = (summary.total && summary.total[cur]) || 0;

  const balanceText = money(spent, cur);
  const heroSub = `−${money(spent, cur)} spent · ${summary.count} receipts · ${cur}`;

  /* ---------- actions ---------- */
  const selectReceipt = useCallback((r: Receipt) => {
    setOpenSwipeId(null);
    setActiveId(r.id);
    setDetailRec(r);
    setDetailVisible(true);
  }, []);

  const closeDetail = useCallback(() => setDetailVisible(false), []);
  const closeUpload = useCallback(() => {
    if (parseBusy) return;
    setUploadVisible(false);
  }, [parseBusy]);

  const removeById = useCallback(
    async (id: number) => {
      setOpenSwipeId(null);
      Alert.alert('Delete receipt', 'Delete this receipt?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReceipt(id);
              if (activeId === id) {
                setActiveId(null);
                setDetailVisible(false);
              }
              await refresh();
            } catch (e) {
              Alert.alert('Delete failed', (e as Error).message);
            }
          },
        },
      ]);
    },
    [activeId, refresh]
  );

  const runParse = useCallback(
    async (payload: { filename: string; mimeType: string; data: string }) => {
      setParseBusy(true);
      setParseError('');
      setParseNote('Parsing receipt…');
      try {
        const res = await parseReceipt(payload);
        setUploadVisible(false);
        await refresh();
        const fresh = receipts.find((r) => r.id === res.id) || {
          id: res.id,
          filename: payload.filename,
          mimeType: payload.mimeType,
          createdAt: new Date().toISOString(),
          merchant: res.merchant,
          parsed: res.parsed,
        };
        setActiveId(res.id);
        setDetailRec(fresh);
        setDetailVisible(true);
      } catch (e) {
        setParseError((e as Error).message);
      } finally {
        setParseBusy(false);
        setParseNote('');
      }
    },
    [receipts, refresh]
  );

  const pickAndParse = useCallback(async () => {
    setParseError('');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.8,
    });
    if (res.canceled || !res.assets.length) return;
    const a = res.assets[0];
    if (!a.base64) {
      setParseError('Could not read the image. Try another file.');
      return;
    }
    await runParse({
      filename: a.fileName || `photo-${Date.now()}.jpg`,
      mimeType: a.mimeType || 'image/jpeg',
      data: a.base64,
    });
  }, [runParse]);

  const captureAndParse = useCallback(async () => {
    setParseError('');
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setParseError('Camera permission is required.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.8,
    });
    if (res.canceled || !res.assets.length) return;
    const a = res.assets[0];
    if (!a.base64) {
      setParseError('Could not read the photo. Try again.');
      return;
    }
    await runParse({
      filename: a.fileName || `photo-${Date.now()}.jpg`,
      mimeType: a.mimeType || 'image/jpeg',
      data: a.base64,
    });
  }, [runParse]);

  const importAndParse = useCallback(async () => {
    setParseError('');
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets.length) return;
    const a = res.assets[0];
    const b64 = await FileSystem.readAsStringAsync(a.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await runParse({
      filename: a.name || `receipt-${Date.now()}.pdf`,
      mimeType: a.mimeType || 'application/pdf',
      data: b64,
    });
  }, [runParse]);

  /* ---------- render ---------- */
  return (
    <View style={[styles.app, { paddingTop: insets.top + 16 }]}>
      {/* header readout */}
      <View style={styles.brandRow}>
        <Text style={styles.brand}>
          Ledger<Text style={styles.brandDot}>.</Text>
        </Text>
        <Pressable
          onPress={() => setHiddenBalance((v) => !v)}
          style={styles.hideBtn}
          hitSlop={8}
        >
          <Text style={styles.hideBtnText}>{hiddenBalance ? 'Show' : 'Hide'}</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => setHiddenBalance((v) => !v)} style={styles.heroTap}>
        <Text style={styles.heroLabel}>Total spend</Text>
        <Text style={[styles.heroTotal, tabularText(30, '600', colors.textMain, { letterSpacing: -0.6 })]}>
          {hiddenBalance ? '••••••' : balanceText}
        </Text>
        <Text style={styles.heroSub}>{hiddenBalance ? 'tap to reveal' : heroSub}</Text>
      </Pressable>

      {/* merchant filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.merchants}
        contentContainerStyle={styles.merchantsContent}
      >
        <MerchantPill
          active={filterKey === 'all'}
          onPress={() => setFilterKey('all')}
          label="All"
        />
        {pillKeys.map((key) => (
          <MerchantPill
            key={key}
            active={filterKey === key}
            onPress={() => setFilterKey(key)}
            label={(merchantMap[key] && merchantMap[key].name) || key}
            count={summary.by_merchant[key].count}
            icon={merchantMap[key]}
          />
        ))}
      </ScrollView>

      {/* feed */}
      <View style={styles.listHead}>
        <Text style={styles.listHeadText}>Recent</Text>
        <Text style={styles.listHeadText}>
          {shown.length ? `${shown.length} receipt${shown.length === 1 ? '' : 's'}` : ''}
        </Text>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.listEmpty}>
            {receipts.length
              ? 'No receipts for this merchant.'
              : 'No receipts logged yet — tap Upload to start.'}
          </Text>
        }
        renderItem={({ item }) => (
          <SwipeRow
            id={item.id}
            open={openSwipeId === item.id}
            onOpenChange={(id, o) => setOpenSwipeId(o ? id : null)}
            onPress={() => selectReceipt(item)}
            onDelete={() => removeById(item.id)}
          >
            <RowBody receipt={item} merchantMap={merchantMap} active={activeId === item.id} />
          </SwipeRow>
        )}
      />

      {/* bottom action bar */}
      <View style={[styles.appbar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          onPress={() => {
            setParseError('');
            setUploadVisible(true);
          }}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
        >
          <Text style={styles.primaryPlus}>+</Text>
          <Text style={styles.primaryText}>Upload receipt</Text>
        </Pressable>
      </View>

      <BottomSheet visible={detailVisible} onClose={closeDetail} bottomInset={insets.bottom}>
        {detailRec && (
          <DetailSheet
            receipt={detailRec}
            merchantMap={merchantMap}
            onDelete={() => removeById(detailRec.id)}
          />
        )}
      </BottomSheet>

      <BottomSheet visible={uploadVisible} onClose={closeUpload} bottomInset={insets.bottom}>
        <View style={styles.uploadSheet}>
          <Text style={styles.uploadTitle}>Add a receipt</Text>
          <Pressable
            style={({ pressed }) => [styles.optionBtn, pressed && styles.optionBtnPressed]}
            disabled={parseBusy}
            onPress={captureAndParse}
          >
            <Text style={styles.optionText}>Take photo</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.optionBtn, pressed && styles.optionBtnPressed]}
            disabled={parseBusy}
            onPress={pickAndParse}
          >
            <Text style={styles.optionText}>Choose from library</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.optionBtn, pressed && styles.optionBtnPressed]}
            disabled={parseBusy}
            onPress={importAndParse}
          >
            <Text style={styles.optionText}>Import PDF</Text>
          </Pressable>
          {parseNote ? (
            <View style={styles.parseStatus}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={styles.parseNote}>{parseNote}</Text>
            </View>
          ) : null}
          {parseError ? <Text style={styles.parseError}>{parseError}</Text> : null}
        </View>
      </BottomSheet>
    </View>
  );
}

/* ================= components ================= */

function MerchantPill({
  active,
  onPress,
  label,
  count,
  icon,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  count?: number;
  icon?: Merchant;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      {icon && <MerchantIcon merchant={icon} mkey={icon.key} size={15} />}
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
      {typeof count === 'number' && (
        <Text style={[styles.pillCount, active && styles.pillCountActive]}>{count}</Text>
      )}
    </Pressable>
  );
}

function RowBody({ receipt, merchantMap, active }: { receipt: Receipt; merchantMap: Record<string, Merchant>; active: boolean }) {
  const p = receipt.parsed || {};
  return (
    <View style={[styles.rowInner, active && styles.rowActive]}>
      <View style={styles.rowIcon}>
        <MerchantIcon merchant={merchantMap[receipt.merchant || 'other']} mkey={receipt.merchant || 'other'} size={22} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {p.vendor || receipt.filename}
        </Text>
        <View style={styles.rowMeta}>
          {p.invoice_date ? <Text style={styles.rowDate}>{p.invoice_date}</Text> : null}
          <View style={styles.tag}>
            <Text style={styles.tagText}>
              {(merchantMap[receipt.merchant] && merchantMap[receipt.merchant].name) || receipt.merchant || 'other'}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.rowAmount}>{money(p.total, p.currency)}</Text>
    </View>
  );
}

function SwipeRow({
  id,
  open,
  onOpenChange,
  onPress,
  onDelete,
  children,
}: {
  id: number;
  open: boolean;
  onOpenChange: (id: number, open: boolean) => void;
  onPress: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(open);
  const startX = useRef(0);

  openRef.current = open;

  useEffect(() => {
    Animated.timing(translateX, { toValue: open ? -SWIPE_WIDTH : 0, duration: 160, useNativeDriver: true }).start();
  }, [open, translateX]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy) && (g.dx < 0 || openRef.current),
      onPanResponderGrant: () => {
        startX.current = openRef.current ? -SWIPE_WIDTH : 0;
        translateX.stopAnimation();
      },
      onPanResponderMove: (_, g) => {
        const x = Math.max(-SWIPE_WIDTH - 12, Math.min(0, startX.current + g.dx));
        translateX.setValue(x);
        if (!openRef.current && x < -SWIPE_WIDTH * 0.6) Vibration.vibrate(10);
      },
      onPanResponderRelease: (_, g) => {
        const x = startX.current + g.dx;
        onOpenChange(id, x < -SWIPE_WIDTH * 0.4);
      },
      onPanResponderTerminate: () => {
        onOpenChange(id, openRef.current);
      },
    })
  ).current;

  return (
    <View style={styles.row}>
      <Pressable style={styles.swipeDelete} onPress={onDelete}>
        <Text style={styles.swipeDeleteText}>Delete</Text>
      </Pressable>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <Pressable onPress={onPress} style={styles.rowPress}>
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function MerchantIcon({ merchant, mkey, size }: { merchant?: Merchant; mkey: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const m = merchant;
  if (!m || !m.icon || failed) {
    return (
      <View style={[styles.monogramBox, { width: size, height: size, borderRadius: size * 0.24 }]}>
        <Text style={[styles.monogramText, { fontSize: Math.max(9, size * 0.55) }]}>
          {(m && m.name ? m.name : mkey).charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `https://cdn.simpleicons.org/${encodeURIComponent(m.icon)}/0A0A0A` }}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function BottomSheet({
  visible,
  onClose,
  bottomInset,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  children: React.ReactNode;
}) {
  const translate = useRef(new Animated.Value(SHEET_OFFSCREEN)).current;
  const scrim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translate.setValue(SHEET_OFFSCREEN);
      scrim.setValue(0);
      Animated.parallel([
        Animated.timing(translate, { toValue: 0, duration: 240, useNativeDriver: true }),
        Animated.timing(scrim, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translate, { toValue: SHEET_OFFSCREEN, duration: 200, useNativeDriver: true }),
        Animated.timing(scrim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, translate, scrim]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]}>
          <Pressable style={styles.scrimPress} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: translate }], paddingBottom: Math.max(bottomInset, 24) },
          ]}
        >
          <View style={styles.handle} />
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={styles.sheetScroll}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DetailSheet({
  receipt,
  merchantMap,
  onDelete,
}: {
  receipt: Receipt;
  merchantMap: Record<string, Merchant>;
  onDelete: () => void;
}) {
  const p: ParsedReceipt = receipt.parsed || {};
  const cur = p.currency || 'EUR';
  const insets = useSafeAreaInsets();
  void insets;

  return (
    <View>
      <View style={styles.rHead}>
        <View style={styles.rId}>
          <View style={styles.rIcon}>
            <MerchantIcon merchant={merchantMap[receipt.merchant || 'other']} mkey={receipt.merchant || 'other'} size={24} />
          </View>
          <View style={styles.rIdText}>
            <Text style={styles.rVendor} numberOfLines={2}>
              {p.vendor || 'Unknown vendor'}
            </Text>
            {p.invoice_date ? <Text style={styles.rDate}>{p.invoice_date}</Text> : null}
          </View>
        </View>
        <Pressable onPress={onDelete} style={styles.rDelete} hitSlop={6}>
          <Text style={styles.rDeleteText}>Delete</Text>
        </Pressable>
      </View>

      <View style={styles.rMeta}>
        <View>
          <Text style={styles.mLabel}>Invoice</Text>
          <Text style={styles.mValue}>{p.invoice_number || '—'}</Text>
        </View>
        <View>
          <Text style={styles.mLabel}>Currency</Text>
          <Text style={styles.mValue}>{p.currency || '—'}</Text>
        </View>
        <View>
          <Text style={styles.mLabel}>File</Text>
          <Text style={[styles.mValue, styles.mFile]} numberOfLines={2}>
            {receipt.filename}
          </Text>
        </View>
      </View>

      <View style={styles.itemsHead}>
        <Text style={styles.itemsHeadText}>Item</Text>
        <Text style={styles.itemsHeadNum}>Qty</Text>
        <Text style={styles.itemsHeadNum}>Unit</Text>
        <Text style={styles.itemsHeadNum}>Total</Text>
      </View>
      {(p.items || []).map((it, i) => (
        <View key={i} style={styles.itemsRow}>
          <Text style={styles.itemsName} numberOfLines={1}>
            {it.name || '—'}
          </Text>
          <Text style={styles.itemsNum}>{it.quantity ?? ''}</Text>
          <Text style={styles.itemsNum}>{money(it.unit_price, cur)}</Text>
          <Text style={styles.itemsNum}>{money(it.total, cur)}</Text>
        </View>
      ))}

      <View style={styles.totals}>
        <View style={styles.tRow}>
          <Text style={styles.tLabel}>Subtotal</Text>
          <Text style={styles.tValue}>{money(p.subtotal, cur)}</Text>
        </View>
        {(p.tax || []).map((t, i) => (
          <View key={i} style={styles.tRow}>
            <Text style={styles.tLabel}>VAT {t.rate_percent ?? '?'}%</Text>
            <Text style={styles.tValue}>{money(t.amount, cur)}</Text>
          </View>
        ))}
        <View style={styles.tTotal}>
          <Text style={styles.tTotalLabel}>Total</Text>
          <Text style={styles.tTotalValue}>{money(p.total, cur)}</Text>
        </View>
      </View>

      <View style={styles.rFoot}>
        <Text style={styles.rFootText}>Parsed by Gemini</Text>
        <Text style={styles.rFootText}>Stored in SQLite</Text>
      </View>
    </View>
  );
}

/* ================= styles ================= */

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.bgApp,
    paddingHorizontal: 20,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  brand: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMain,
  },
  brandDot: { color: colors.expense },
  hideBtn: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  hideBtnText: { fontSize: 13, color: colors.textMuted },
  heroTap: { marginBottom: 8 },
  heroLabel: {
    ...typeScale.section,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroTotal: {},
  heroSub: { marginTop: 4, fontSize: 15, color: colors.textMuted },
  merchants: { flexGrow: 0, marginHorizontal: -20, marginBottom: 6 },
  merchantsContent: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  pillActive: { backgroundColor: colors.textMain, borderColor: colors.textMain },
  pillText: { fontSize: 13, fontWeight: '500', color: colors.textMain },
  pillTextActive: { color: '#FFFFFF' },
  pillCount: { fontSize: 12, color: colors.textMuted, ...tabular },
  pillCountActive: { color: 'rgba(255,255,255,0.7)' },
  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  listHeadText: {
    ...typeScale.section,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  listEmpty: { paddingVertical: 24, fontSize: 14, color: colors.textMuted },

  row: { overflow: 'hidden' },
  swipeDelete: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: SWIPE_WIDTH,
    backgroundColor: colors.expense,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  swipeDeleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  rowPress: { backgroundColor: colors.bgApp },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgApp,
  },
  rowActive: { backgroundColor: colors.bgIcon },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.bgIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { ...typeScale.rowTitle, color: colors.textMain },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowDate: { fontSize: 12, color: colors.textMuted },
  tag: {
    backgroundColor: colors.bgIcon,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
    maxWidth: 130,
  },
  tagText: { fontSize: 12, color: colors.textMuted },
  rowAmount: { ...typeScale.rowAmount, color: colors.expense, ...tabular },

  appbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgApp,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.textMain,
  },
  primaryPressed: { opacity: 0.92 },
  primaryPlus: { fontSize: 20, fontWeight: '500', color: '#FFFFFF' },
  primaryText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: colors.scrim },
  scrimPress: { flex: 1 },
  sheet: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    maxHeight: '88%',
    paddingTop: 10,
  },
  sheetScroll: { paddingHorizontal: 24 },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderSubtle,
    alignSelf: 'center',
    marginBottom: 18,
  },

  uploadSheet: { paddingBottom: 8 },
  uploadTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textMain,
    marginBottom: 16,
    textAlign: 'center',
  },
  optionBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  optionBtnPressed: { backgroundColor: colors.bgIcon },
  optionText: { fontSize: 15, fontWeight: '500', color: colors.textMain },
  parseStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  parseNote: { fontSize: 13, color: colors.textMuted },
  parseError: { marginTop: 10, fontSize: 13, color: colors.expense, textAlign: 'center' },

  monogramBox: {
    backgroundColor: colors.bgIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: { fontWeight: '600', color: colors.icon },

  rHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  rId: { flexDirection: 'row', gap: 12, alignItems: 'center', flex: 1, minWidth: 0 },
  rIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.bgIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rIdText: { flex: 1, minWidth: 0 },
  rVendor: { fontSize: 19, fontWeight: '600', color: colors.textMain },
  rDate: { fontSize: 13, color: colors.textMuted, ...tabular, marginTop: 2 },
  rDelete: { paddingVertical: 10, paddingHorizontal: 8 },
  rDeleteText: { fontSize: 14, color: colors.textMuted },
  rMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  mLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  mValue: { fontSize: 14, fontWeight: '500', color: colors.textMain, marginTop: 2 },
  mFile: { maxWidth: 140 },
  itemsHead: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  itemsHeadText: { flex: 1, fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  itemsHeadNum: { width: 72, fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  itemsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  itemsName: { flex: 1, fontSize: 14, color: colors.textMain, paddingRight: 8 },
  itemsNum: { width: 72, fontSize: 14, fontWeight: '500', color: colors.textMain, textAlign: 'right', ...tabular },
  totals: { marginTop: 12, alignItems: 'flex-end' },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, minWidth: 200 },
  tLabel: { fontSize: 14, color: colors.textMuted },
  tValue: { fontSize: 14, fontWeight: '500', color: colors.textMain, ...tabular },
  tTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: 200,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.textMain,
  },
  tTotalLabel: { fontSize: 15, color: colors.textMain, fontWeight: '500' },
  tTotalValue: { fontSize: 18, fontWeight: '600', color: colors.textMain, ...tabular },
  rFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  rFootText: { fontSize: 12, color: colors.textMuted },
});
