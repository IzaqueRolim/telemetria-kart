import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ComponentProps, ReactNode, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '../lib/theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { c } = useThemeColors();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? c.text} />;
}

export function Screen({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useThemeColors();
  return <SafeAreaView style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</SafeAreaView>;
}

export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  const { c } = useThemeColors();
  return (
    <View
      style={[
        { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
        accent ? { borderLeftWidth: 6, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useThemeColors();
  return <Text style={[{ color: c.muted, fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }, style]}>{children}</Text>;
}

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useThemeColors();
  return <Text style={[{ color: c.text, fontSize: 30, fontWeight: '900', letterSpacing: 0.3 }, style]}>{children}</Text>;
}

export function Field(props: TextInputProps & { label: string }) {
  const { c } = useThemeColors();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Label style={{ fontSize: 11 }}>{label}</Label>
      <TextInput
        placeholderTextColor={c.faint}
        style={[
          {
            height: 54,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.card2,
            color: c.text,
            paddingHorizontal: 16,
            fontSize: 18,
            fontWeight: '700',
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

interface BtnProps {
  title: string;
  onPress?: () => unknown;
  variant?: 'primary' | 'ghost' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Exige segurar o botão por N ms (segurança: evita toques acidentais
   * durante a condução). Mostra uma barra de progresso enquanto segura.
   */
  holdMs?: number;
  compact?: boolean;
}

export function Btn({ title, onPress, variant = 'primary', icon, loading, disabled, style, holdMs, compact }: BtnProps) {
  const { c } = useThemeColors();
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bg = variant === 'primary' ? c.green : variant === 'danger' ? c.red : c.card2;
  const fg = variant === 'ghost' ? c.text : variant === 'primary' ? c.onAccent : '#fff';
  const off = disabled || loading;

  const startHold = () => {
    if (!holdMs || off) return;
    setHolding(true);
    Animated.timing(progress, { toValue: 1, duration: holdMs, useNativeDriver: false }).start();
    timer.current = setTimeout(() => {
      setHolding(false);
      progress.setValue(0);
      onPress?.();
    }, holdMs);
  };
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    progress.stopAnimation();
    progress.setValue(0);
  };

  return (
    <Pressable
      disabled={off}
      onPress={holdMs ? undefined : () => onPress?.()}
      onPressIn={startHold}
      onPressOut={cancelHold}
      style={({ pressed }) => [
        {
          height: compact ? 42 : 56,
          paddingHorizontal: compact ? 14 : 20,
          borderRadius: 14,
          backgroundColor: bg,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {holdMs ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(255,255,255,0.28)',
              width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      ) : null}
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={compact ? 18 : 22} /> : null}
      <Text style={{ color: fg, fontWeight: '900', fontSize: compact ? 13 : 16, letterSpacing: 1, textTransform: 'uppercase' }}>
        {holding ? 'Segure…' : title}
      </Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { c } = useThemeColors();
  if (!children) return null;
  return (
    <View style={{ backgroundColor: c.redSoft, borderRadius: 12, padding: 12 }}>
      <Text style={{ color: c.red, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

/** Indicador de GPS + conexão (cabeçalho, como "GPS OK ▮▮▮▮" da referência). */
export function SignalBadge({
  gps,
  accuracy,
  connection,
  pending,
}: {
  gps: 'off' | 'searching' | 'ok' | 'weak' | 'denied';
  accuracy: number | null;
  connection: 'connecting' | 'online' | 'offline';
  pending: number;
}) {
  const { c } = useThemeColors();
  const gpsColor = gps === 'ok' ? c.green : gps === 'weak' || gps === 'searching' ? c.amber : c.red;
  const gpsText = gps === 'ok' ? 'GPS OK' : gps === 'weak' ? `GPS ±${accuracy ?? '?'}m` : gps === 'searching' ? 'GPS…' : gps === 'denied' ? 'SEM GPS' : 'GPS OFF';
  const bars = connection === 'online' ? 4 : connection === 'connecting' ? 2 : 0;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: c.card,
      }}
    >
      <Icon name="crosshairs-gps" size={18} color={gpsColor} />
      <Text style={{ color: gpsColor, fontWeight: '900', fontSize: 13, letterSpacing: 0.8 }}>{gpsText}</Text>
      <View style={{ width: 1, height: 18, backgroundColor: c.border }} />
      {connection === 'offline' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="wifi-off" size={16} color={c.red} />
          {pending > 0 && <Text style={{ color: c.amber, fontWeight: '800', fontSize: 12 }}>{pending}</Text>}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: 4, height: 5 + i * 3.5, borderRadius: 1, backgroundColor: i < bars ? c.green : c.border }} />
          ))}
        </View>
      )}
    </View>
  );
}
