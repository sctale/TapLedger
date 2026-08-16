import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { COLORS, FONT_SIZE, SPACING, findCategory } from '../constants';

interface Slice {
  category: string;
  total: number;
  color: string;
}

interface Props {
  data: { category: string; total: number }[];
  type: 'expense' | 'income';
  height?: number;
}

// 分类占比饼图（SVG 圆环）
export default function CategoryPieChart({ data, type, height = 180 }: Props) {
  const total = data.reduce((s, d) => s + d.total, 0);
  const slices: Slice[] = data.map((d) => ({
    category: d.category,
    total: d.total,
    color: findCategory(d.category, type).color,
  }));

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
          <Text style={styles.centerValue}>{Math.round(total)}</Text>
        </View>
      </View>
      <View style={styles.legend}>
        {slices.map((slice) => (
          <View key={slice.category} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: slice.color }]} />
            <Text style={styles.legendLabel}>{findCategory(slice.category, type).label}</Text>
            <Text style={styles.legendValue}>
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs + 2,
    justifyContent: 'space-between',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '48%',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  legendValue: {
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.text,
    fontWeight: '600',
  },
});
