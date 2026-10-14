/** Cores distintas para os karts (boa leitura em fundo claro e escuro). */
export const PILOT_COLORS = [
  '#22C55E', // verde
  '#3B82F6', // azul
  '#EF4444', // vermelho
  '#F59E0B', // âmbar
  '#A855F7', // roxo
  '#06B6D4', // ciano
  '#EC4899', // rosa
  '#84CC16', // lima
  '#F97316', // laranja
  '#14B8A6', // turquesa
  '#EAB308', // amarelo
  '#6366F1', // índigo
];

export function pilotColor(index: number): string {
  return PILOT_COLORS[index % PILOT_COLORS.length];
}
