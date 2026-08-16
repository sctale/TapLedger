import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { COLORS, FONT_SIZE, SPACING } from '../constants';

interface Props {
  values: number[];        // 每日/每月支出
  labels: string[];        // 对应标签（如 "8/1" 或 "一"）
  height?: number;
  color?: string;
}

const CHART_W = 320;       // viewBox 固定宽
const PADDING_X = 6;       // 左右内边距
const BAR_H = 100;         // 柱子可用的最大高度

// 柱状趋势图（自适应柱宽，标签自动抽样对齐）
export default function TrendBarChart({ values, labels, height = 150, color = COLORS.expense }: Props) {
  const n = values.length;
  const gap = n > 18 ? 2 : n > 10 ? 4 : 6;
  const barWidth = Math.max((CHART_W - PADDING_X * 2 - gap * (n - 1)) / n, 2);
  const max = Math.max(...values, 1);

  // 标签抽样：数据多时只显示部分标签，避免拥挤
  const labelStep = n > 18 ? Math.ceil(n / 6) : n > 10 ? Math.ceil(n / 7) : 1;

  return (
    <View>
      <Svg width="100%" height={height - 18} viewBox={`0 0 ${CHART_W} 110`}>
        {values.map((v, i) => {
          const barHeight = Math.max((v / max) * BAR_H, v > 0 ? 4 : 1.5);
          const x = PADDING_X + i * (barWidth + gap);
          const y = 108 - barHeight;
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={barWidth > 6 ? 5 : 2}
              fill={v > 0 ? color : COLORS.borderSubtle}
              opacity={v > 0 ? 0.85 : 1}
            />
          );
        })}
      </Svg>
      <View style={styles.labels}>
        {labels.map((label, i) => {
          const show = i % labelStep === 0 || i === n - 1;
          return (
            <Text key={i} style={styles.label} numberOfLines={1}>
              {show ? label : ''}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: 'row',
    marginTop: SPACING.xs,
  },
  label: {
    flex: 1,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
});
