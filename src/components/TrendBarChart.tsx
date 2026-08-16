import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../constants';

interface Props {
  values: number[];        // 每日/每月支出
  labels: string[];        // 对应标签（如 "8/1" 或 "一"）
  height?: number;
  color?: string;
}

const DEFAULT_W = 320;     // onLayout 前的兜底宽度
const PADDING_X = 6;       // 左右内边距
const BAR_H = 100;         // 柱子可用的最大高度
const BAR_BASE = 108;      // 柱底基线 y
const LABEL_Y = 122;       // 标签基线 y（SVG 内绘制，不截断）

// 柱状趋势图（onLayout 实测宽度自适应，标签在 SVG 内按柱心对齐绘制）
export default function TrendBarChart({ values, labels, height = 150, color = COLORS.expense }: Props) {
  const [chartW, setChartW] = useState(DEFAULT_W);

  const n = values.length;
  const gap = n > 18 ? 2 : n > 10 ? 4 : 6;
  const barWidth = Math.max((chartW - PADDING_X * 2 - gap * (n - 1)) / n, 2);
  const max = Math.max(...values, 1);

  // 标签抽样：数据多时只显示部分标签，避免拥挤（首尾必显示）
  const labelStep = n > 18 ? Math.ceil(n / 6) : n > 10 ? Math.ceil(n / 7) : 1;

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== chartW) setChartW(w);
      }}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${chartW} ${LABEL_Y + 6}`}>
        {values.map((v, i) => {
          const barHeight = Math.max((v / max) * BAR_H, v > 0 ? 4 : 1.5);
          const x = PADDING_X + i * (barWidth + gap);
          const y = BAR_BASE - barHeight;
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
        {labels.map((label, i) => {
          const show = i % labelStep === 0 || i === n - 1;
          if (!show || !label) return null;
          const cx = PADDING_X + i * (barWidth + gap) + barWidth / 2;
          return (
            <SvgText
              key={`l-${i}`}
              x={cx}
              y={LABEL_Y}
              fontSize={10}
              textAnchor="middle"
              fill={COLORS.textTertiary}
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
