import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { COLORS, FONT_SIZE, SPACING, findCategory } from '../constants';
import { formatMoney } from '../utils/dateUtils';

interface Slice {
  category: string;
  label: string;
  total: number;
  color: string;
}

interface Props {
  data: { category: string; total: number }[];
  type: 'expense' | 'income';
  height?: number;
}

// 图例最多显示的分类数，超出聚合为「其他」
const MAX_SLICES = 8;
const OTHER_COLOR = '#B0A9A2';

// 分类占比饼图（SVG 圆环）
export default function CategoryPieChart({ data, type, height = 180 }: Props) {
  // 超过 8 项时取 top 8，其余聚合为「其他」
  const slices: Slice[] = React.useMemo(() => {
    const mapped = data.map((d) => {
      const def = findCategory(d.category, type);
      return { category: d.category, label: def.label, total: d.total, color: def.color };
    });
    if (mapped.length <= MAX_SLICES) return mapped;
    const top = mapped.slice(0, MAX_SLICES - 1);
    const rest = mapped.slice(MAX_SLICES - 1);
    top.push({
      category: '__other__',
      label: `其他（${rest.length} 项）`,
      total: rest.reduce((s, x) => s + x.total, 0),
      color: OTHER_COLOR,
    });
    return top;
  }, [data, type]);

  const total = slices.reduce((s, d) => s + d.total, 0);

  // 生成圆环弧线路径（半径随容器高度自适应，避免小屏溢出）
  const strokeWidth = 26;
  const radius = Math.max((height - strokeWidth) / 2 - 4, 30);
  const circumference = 2 * Math.PI * radius;

  let accumulated = 0;
  const arcs = slices.map((slice) => {
    const fraction = total > 0 ? slice.total / total : 0;
    const arc = {
      ...slice,
      start: accumulated,
      fraction,
    };
    accumulated += fraction;
    return arc;
  });

  return (
    <View style={styles.container}>
      <View style={{ width: height, height }}>
        <Svg width={height} height={height} viewBox={`0 0 ${height} ${height}`}>
          <G rotation={-90} origin={`${height / 2}, ${height / 2}`}>
            <Circle
              cx={height / 2}
              cy={height / 2}
              r={radius}
              stroke={COLORS.bgAlt}
              strokeWidth={strokeWidth}
              fill="none"
            />
            {arcs.map((arc) => {
              if (arc.fraction <= 0) return null;
              return (
                <Circle
                  key={arc.category}
                  cx={height / 2}
                  cy={height / 2}
                  r={radius}
                  stroke={arc.color}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={`${circumference * arc.fraction} ${circumference}`}
                  strokeDashoffset={-circumference * arc.start}
                />
              );
            })}
          </G>
        </Svg>
        <View style={styles.center}>
          <Text style={styles.centerLabel}>{type === 'expense' ? '总支出' : '总收入'}</Text>
          <Text style={styles.centerValue} adjustsFontSizeToFit numberOfLines={1}>
            {formatMoney(total)}
          </Text>
        </View>
      </View>
      <View style={styles.legend}>
        {slices.map((slice) => (
          <View key={slice.category} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: slice.color }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {slice.label}
            </Text>
            <Text style={styles.legendValue} numberOfLines={1}>
              ¥{formatMoney(slice.total)}
            </Text>
            <Text style={styles.legendPct}>
              {total > 0 ? `${Math.round((slice.total / total) * 100)}%` : '0%'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  centerLabel: {
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.textTertiary,
  },
  centerValue: {
    fontSize: FONT_SIZE.xxl - 4,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 2,
  },
  legend: {
    width: '100%',
    gap: SPACING.xs + 2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flexShrink: 1,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  legendValue: {
    marginLeft: 'auto',
    fontSize: FONT_SIZE.sm,
    color: COLORS.text,
    fontWeight: '600',
  },
  legendPct: {
    width: 38,
    textAlign: 'right',
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.textTertiary,
  },
});
