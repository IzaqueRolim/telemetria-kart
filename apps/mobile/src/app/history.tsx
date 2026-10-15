import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Btn, Card, H1, Icon, Screen } from '../components/ui';
import { HistoryEntry, storage } from '../lib/storage';
import { useThemeColors } from '../lib/theme';

export default function History() {
  const { c } = useThemeColors();
  const [list, setList] = useState<HistoryEntry[]>([]);
  useFocusEffect(
    useCallback(() => {
      storage.history().then(setList);
    }, []),
  );

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12, flex: 1, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Icon name="arrow-left" />
          </Pressable>
          <H1 style={{ fontSize: 24 }}>Minhas corridas</H1>
        </View>
        <FlatList
          data={list}
          keyExtractor={(e) => `${e.code}-${e.pilotId}`}
          contentContainerStyle={{ gap: 10 }}
          ListEmptyComponent={<Text style={{ color: c.muted }}>Suas corridas encerradas aparecem aqui.</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push({ pathname: '/report', params: { code: item.code, pilotId: item.pilotId } })}>
              <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Icon name="flag-checkered" color={c.green} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{item.trackName}</Text>
                  <Text style={{ color: c.muted }}>
                    {new Date(item.date).toLocaleString('pt-BR')} · sala {item.code} · {item.pilotName}
                  </Text>
                </View>
                <Icon name="chevron-right" color={c.muted} />
              </Card>
            </Pressable>
          )}
        />
        <Btn title="Voltar" variant="ghost" compact onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
