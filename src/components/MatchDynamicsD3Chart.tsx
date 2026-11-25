import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { MatchAnalysis } from '../types/football';
import {
  generateMatchDynamicsData,
  OddsIntervalPoint,
  PossessionIntervalPoint,
} from '../services/d3DynamicsService';
import { TrendingDown, TrendingUp, Minus, LineChart as LineChartIcon, Activity } from 'lucide-react';

interface MatchDynamicsD3ChartProps {
  match: MatchAnalysis;
}

type ChartCategory = 'odds' | 'possession';
type OddsSeriesKey = 'homeWin' | 'draw' | 'awayWin' | 'over25';
type PossessionStyle = 'bars' | 'wave';

interface SeriesConfig {
  key: OddsSeriesKey;
  label: string;
  shortLabel: string;
  color: string;
  darkColor: string;
}

export const MatchDynamicsD3Chart: React.FC<MatchDynamicsD3ChartProps> = ({ match }) => {
  const [category, setCategory] = useState<ChartCategory>('odds');
  const [possessionStyle, setPossessionStyle] = useState<PossessionStyle>('bars');
  const [visibleSeries, setVisibleSeries] = useState<Record<OddsSeriesKey, boolean>>({
    homeWin: true,
    draw: true,
    awayWin: true,
    over25: true,
  });

  const [hoveredOddsIndex, setHoveredOddsIndex] = useState<number | null>(null);
  const [hoveredPossIndex, setHoveredPossIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [chartWidth, setChartWidth] = useState<number>(760);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const data = useMemo(() => generateMatchDynamicsData(match), [match]);

  const seriesConfigs: SeriesConfig[] = useMemo(
    () => [
      {
        key: 'homeWin',
        label: `П1 (${match.homeTeam})`,
        shortLabel: 'П1',
        color: '#2563eb',
        darkColor: '#60a5fa',
      },
      {
        key: 'draw',
        label: 'X (Ничья)',
        shortLabel: 'X',
        color: '#d97706',
        darkColor: '#fbbf24',
      },
      {
        key: 'awayWin',
        label: `П2 (${match.awayTeam})`,
        shortLabel: 'П2',
        color: '#059669',
        darkColor: '#34d399',
      },
      {
        key: 'over25',
        label: 'ТБ 2.5',
        shortLabel: 'ТБ 2.5',
        color: '#7c3aed',
        darkColor: '#a78bfa',
      },
    ],
    [match.homeTeam, match.awayTeam]
  );

  // Sync dark mode reactively
  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Track responsive container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const next = Math.max(320, Math.floor(el.getBoundingClientRect().width));
      setChartWidth(next);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleSeries = (key: OddsSeriesKey) => {
    setVisibleSeries((prev) => {
      const activeCount = Object.values(prev).filter(Boolean).length;
      if (prev[key] && activeCount <= 1) return prev; // Keep at least 1 series visible
      return { ...prev, [key]: !prev[key] };
    });
  };

  // Render D3.js SVG chart
  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode) return;

    const svg = d3.select(svgNode);
    svg.selectAll('*').remove();

    const height = 280;
    const margin =
      category === 'odds'
        ? { top: 24, right: 26, bottom: 38, left: 48 }
        : { top: 24, right: 24, bottom: 38, left: 48 };
    const innerWidth = Math.max(220, chartWidth - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    const axisTextColor = isDark ? '#a3a3a3' : '#525252';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
    const dividerColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.18)';
    const homeColor = isDark ? '#60a5fa' : '#2563eb';
    const awayColor = isDark ? '#34d399' : '#059669';

    svg.attr('viewBox', `0 0 ${chartWidth} ${height}`).attr('width', chartWidth).attr('height', height);

    const defs = svg.append('defs');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    if (category === 'odds') {
      const activeConfigs = seriesConfigs.filter((s) => visibleSeries[s.key]);
      const seriesData = data.oddsSeries;

      const xScale = d3
        .scalePoint<string>()
        .domain(seriesData.map((d) => d.label))
        .range([0, innerWidth])
        .padding(0.15);

      const allValues: number[] = [];
      for (const pt of seriesData) {
        for (const s of activeConfigs) {
          allValues.push(pt[s.key]);
        }
      }
      const minVal = d3.min(allValues) ?? 1.2;
      const maxVal = d3.max(allValues) ?? 4.5;
      const pad = Math.max(0.25, (maxVal - minVal) * 0.16);

      const yScale = d3
        .scaleLinear()
        .domain([Math.max(1.0, minVal - pad), maxVal + pad])
        .nice()
        .range([innerHeight, 0]);

      // Horizontal gridlines
      const yTicks = yScale.ticks(5);
      g.selectAll('.grid-line')
        .data(yTicks)
        .enter()
        .append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', (d) => yScale(d))
        .attr('y2', (d) => yScale(d))
        .attr('stroke', gridColor)
        .attr('stroke-dasharray', '3,3');

      // Highlight projected region if live or upcoming
      const firstProjectedIdx = seriesData.findIndex((d) => d.isProjected);
      if (firstProjectedIdx > 0) {
        const splitX = xScale(seriesData[firstProjectedIdx - 1].label) ?? 0;
        g.append('rect')
          .attr('x', splitX)
          .attr('y', 0)
          .attr('width', Math.max(0, innerWidth - splitX))
          .attr('height', innerHeight)
          .attr('fill', isDark ? 'rgba(255,255,255,0.025)' : 'rgba(15,23,42,0.025)');

        g.append('line')
          .attr('x1', splitX)
          .attr('x2', splitX)
          .attr('y1', 0)
          .attr('y2', innerHeight)
          .attr('stroke', isDark ? '#fb7185' : '#e11d48')
          .attr('stroke-width', 1.25)
          .attr('stroke-dasharray', '4,3')
          .attr('opacity', 0.75);

        g.append('text')
          .attr('x', Math.min(innerWidth - 4, splitX + 6))
          .attr('y', 11)
          .attr('fill', isDark ? '#fda4af' : '#be123c')
          .attr('font-size', '10px')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-weight', '600')
          .text(match.status === 'live' ? `Сейчас (${match.liveMinute ?? 45}') → Прогноз` : 'Прогноз линии');
      }

      // Subtle area gradient under the first visible series
      const primarySeries = activeConfigs[0];
      if (primarySeries) {
        const gradId = `d3-odds-grad-${primarySeries.key}`;
        const grad = defs
          .append('linearGradient')
          .attr('id', gradId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%');
        const col = isDark ? primarySeries.darkColor : primarySeries.color;
        grad.append('stop').attr('offset', '0%').attr('stop-color', col).attr('stop-opacity', 0.16);
        grad.append('stop').attr('offset', '100%').attr('stop-color', col).attr('stop-opacity', 0.0);

        const areaGen = d3
          .area<OddsIntervalPoint>()
          .x((d) => xScale(d.label) ?? 0)
          .y0(innerHeight)
          .y1((d) => yScale(d[primarySeries.key]))
          .curve(d3.curveMonotoneX);

        g.append('path').datum(seriesData).attr('d', areaGen).attr('fill', `url(#${gradId})`);
      }

      // Draw each active odds line (solid for actual, dashed for projected)
      activeConfigs.forEach((s) => {
        const strokeColor = isDark ? s.darkColor : s.color;
        const lineGen = d3
          .line<OddsIntervalPoint>()
          .x((d) => xScale(d.label) ?? 0)
          .y((d) => yScale(d[s.key]))
          .curve(d3.curveMonotoneX);

        if (firstProjectedIdx > 0) {
          const actualSlice = seriesData.slice(0, firstProjectedIdx);
          const projectedSlice = seriesData.slice(firstProjectedIdx - 1);

          g.append('path')
            .datum(actualSlice)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-width', 2.4)
            .attr('stroke-linecap', 'round')
            .attr('d', lineGen);

          g.append('path')
            .datum(projectedSlice)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '5,4')
            .attr('opacity', 0.7)
            .attr('d', lineGen);
        } else {
          g.append('path')
            .datum(seriesData)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-width', 2.4)
            .attr('stroke-linecap', 'round')
            .attr('d', lineGen);
        }

        // Data points
        g.selectAll(`.pt-${s.key}`)
          .data(seriesData)
          .enter()
          .append('circle')
          .attr('cx', (d) => xScale(d.label) ?? 0)
          .attr('cy', (d) => yScale(d[s.key]))
          .attr('r', (_, idx) => (hoveredOddsIndex === idx ? 5.5 : 3.5))
          .attr('fill', (d) => (d.isProjected ? (isDark ? '#171717' : '#ffffff') : strokeColor))
          .attr('stroke', strokeColor)
          .attr('stroke-width', 2);
      });

      // Goal markers along the top
      seriesData.forEach((pt) => {
        if (pt.goalEventText && !pt.isProjected) {
          const cx = xScale(pt.label) ?? 0;
          g.append('line')
            .attr('x1', cx)
            .attr('x2', cx)
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('stroke', isDark ? '#34d399' : '#059669')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '2,2')
            .attr('opacity', 0.5);

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', 6)
            .attr('r', 4)
            .attr('fill', isDark ? '#34d399' : '#059669');
        }
      });

      // Active hover vertical guide
      if (hoveredOddsIndex !== null && seriesData[hoveredOddsIndex]) {
        const hx = xScale(seriesData[hoveredOddsIndex].label) ?? 0;
        g.append('line')
          .attr('x1', hx)
          .attr('x2', hx)
          .attr('y1', 0)
          .attr('y2', innerHeight)
          .attr('stroke', dividerColor)
          .attr('stroke-width', 1.25);
      }

      // Axes
      const xAxis = d3.axisBottom(xScale).tickSize(0).tickPadding(12);
      const yAxis = d3
        .axisLeft(yScale)
        .ticks(5)
        .tickSize(0)
        .tickPadding(10)
        .tickFormat((d) => Number(d).toFixed(2));

      g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(xAxis)
        .call((axis) => axis.select('.domain').attr('stroke', dividerColor))
        .selectAll('text')
        .attr('fill', axisTextColor)
        .attr('font-size', '11px')
        .attr('font-family', 'JetBrains Mono, monospace');

      g.append('g')
        .call(yAxis)
        .call((axis) => axis.select('.domain').remove())
        .selectAll('text')
        .attr('fill', axisTextColor)
        .attr('font-size', '11px')
        .attr('font-family', 'JetBrains Mono, monospace');

      // Invisible interactive hit zones per interval
      const stepWidth = innerWidth / Math.max(1, seriesData.length);
      g.selectAll('.odds-hit')
        .data(seriesData)
        .enter()
        .append('rect')
        .attr('x', (d) => Math.max(0, (xScale(d.label) ?? 0) - stepWidth / 2))
        .attr('y', 0)
        .attr('width', stepWidth)
        .attr('height', innerHeight)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mouseenter mousemove', (event, d) => {
          const idx = seriesData.indexOf(d);
          setHoveredOddsIndex(idx);
          const bounds = containerRef.current?.getBoundingClientRect();
          if (bounds) {
            setTooltipPos({
              x: event.clientX - bounds.left,
              y: event.clientY - bounds.top,
            });
          }
        })
        .on('mouseleave', () => setHoveredOddsIndex(null));
    } else {
      // POSSESSION D3 CHART (15-minute intervals)
      const seriesData = data.possessionSeries;
      const yScale = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);

      // Horizontal gridlines at 0, 25, 50, 75, 100
      [0, 25, 50, 75, 100].forEach((tickVal) => {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yScale(tickVal))
          .attr('y2', yScale(tickVal))
          .attr('stroke', tickVal === 50 ? (isDark ? '#f59e0b' : '#d97706') : gridColor)
          .attr('stroke-width', tickVal === 50 ? 1.4 : 1)
          .attr('stroke-dasharray', tickVal === 50 ? '5,4' : '3,3')
          .attr('opacity', tickVal === 50 ? 0.75 : 1);
      });

      if (possessionStyle === 'bars') {
        const xScale = d3
          .scaleBand<string>()
          .domain(seriesData.map((d) => d.label))
          .range([0, innerWidth])
          .padding(0.26);

        const bw = xScale.bandwidth();

        // Away possession (top segment: from homePossession% to 100%)
        g.selectAll('.away-bar')
          .data(seriesData)
          .enter()
          .append('rect')
          .attr('x', (d) => xScale(d.label) ?? 0)
          .attr('y', yScale(100))
          .attr('width', bw)
          .attr('height', (d) => Math.max(0, yScale(d.homePossession) - yScale(100) - 2))
          .attr('rx', 4)
          .attr('fill', awayColor)
          .attr('opacity', (d, idx) =>
            hoveredPossIndex === idx ? 0.98 : d.isProjected ? 0.45 : 0.82
          );

        // Home possession (bottom segment: from 0% to homePossession%)
        g.selectAll('.home-bar')
          .data(seriesData)
          .enter()
          .append('rect')
          .attr('x', (d) => xScale(d.label) ?? 0)
          .attr('y', (d) => yScale(d.homePossession))
          .attr('width', bw)
          .attr('height', (d) => Math.max(0, innerHeight - yScale(d.homePossession)))
          .attr('rx', 4)
          .attr('fill', homeColor)
          .attr('opacity', (d, idx) =>
            hoveredPossIndex === idx ? 1 : d.isProjected ? 0.48 : 0.88
          );

        // Numeric labels inside bars
        g.selectAll('.home-lbl')
          .data(seriesData)
          .enter()
          .append('text')
          .attr('x', (d) => (xScale(d.label) ?? 0) + bw / 2)
          .attr('y', (d) => yScale(d.homePossession / 2) + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#ffffff')
          .attr('font-size', '11px')
          .attr('font-weight', '700')
          .attr('font-family', 'JetBrains Mono, monospace')
          .text((d) => `${d.homePossession}%`);

        g.selectAll('.away-lbl')
          .data(seriesData)
          .enter()
          .append('text')
          .attr('x', (d) => (xScale(d.label) ?? 0) + bw / 2)
          .attr('y', (d) => yScale(d.homePossession + d.awayPossession / 2) + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#ffffff')
          .attr('font-size', '11px')
          .attr('font-weight', '700')
          .attr('font-family', 'JetBrains Mono, monospace')
          .text((d) => `${d.awayPossession}%`);

        // Highlight active live interval border
        seriesData.forEach((d) => {
          if (d.isCurrentInterval) {
            g.append('rect')
              .attr('x', (xScale(d.label) ?? 0) - 3)
              .attr('y', -3)
              .attr('width', bw + 6)
              .attr('height', innerHeight + 6)
              .attr('rx', 6)
              .attr('fill', 'none')
              .attr('stroke', isDark ? '#fb7185' : '#e11d48')
              .attr('stroke-width', 1.75)
              .attr('stroke-dasharray', '4,3');
          }
        });

        // Re-draw 50% equilibrium line above bars for precision reference
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yScale(50))
          .attr('y2', yScale(50))
          .attr('stroke', isDark ? '#fde68a' : '#78350f')
          .attr('stroke-width', 1.25)
          .attr('stroke-dasharray', '5,4')
          .attr('opacity', 0.85);

        const xAxis = d3.axisBottom(xScale).tickSize(0).tickPadding(12);
        g.append('g')
          .attr('transform', `translate(0,${innerHeight})`)
          .call(xAxis)
          .call((axis) => axis.select('.domain').attr('stroke', dividerColor))
          .selectAll('text')
          .attr('fill', axisTextColor)
          .attr('font-size', '11px')
          .attr('font-family', 'JetBrains Mono, monospace');

        // Hit overlays
        g.selectAll('.poss-hit')
          .data(seriesData)
          .enter()
          .append('rect')
          .attr('x', (d) => xScale(d.label) ?? 0)
          .attr('y', 0)
          .attr('width', bw)
          .attr('height', innerHeight)
          .attr('fill', 'transparent')
          .style('cursor', 'pointer')
          .on('mouseenter mousemove', (event, d) => {
            setHoveredPossIndex(seriesData.indexOf(d));
            const bounds = containerRef.current?.getBoundingClientRect();
            if (bounds) {
              setTooltipPos({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              });
            }
          })
          .on('mouseleave', () => setHoveredPossIndex(null));
      } else {
        // CONTINUOUS WAVE STREAM VIEW (D3 Area)
        const xScale = d3
          .scalePoint<string>()
          .domain(seriesData.map((d) => d.label))
          .range([0, innerWidth])
          .padding(0.12);

        const homeGrad = defs
          .append('linearGradient')
          .attr('id', 'd3-poss-home-grad')
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%');
        homeGrad.append('stop').attr('offset', '0%').attr('stop-color', homeColor).attr('stop-opacity', 0.45);
        homeGrad.append('stop').attr('offset', '100%').attr('stop-color', homeColor).attr('stop-opacity', 0.14);

        const awayGrad = defs
          .append('linearGradient')
          .attr('id', 'd3-poss-away-grad')
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%');
        awayGrad.append('stop').attr('offset', '0%').attr('stop-color', awayColor).attr('stop-opacity', 0.16);
        awayGrad.append('stop').attr('offset', '100%').attr('stop-color', awayColor).attr('stop-opacity', 0.42);

        const homeArea = d3
          .area<PossessionIntervalPoint>()
          .x((d) => xScale(d.label) ?? 0)
          .y0(innerHeight)
          .y1((d) => yScale(d.homePossession))
          .curve(d3.curveMonotoneX);

        const awayArea = d3
          .area<PossessionIntervalPoint>()
          .x((d) => xScale(d.label) ?? 0)
          .y0(0)
          .y1((d) => yScale(d.homePossession))
          .curve(d3.curveMonotoneX);

        const dividerLine = d3
          .line<PossessionIntervalPoint>()
          .x((d) => xScale(d.label) ?? 0)
          .y((d) => yScale(d.homePossession))
          .curve(d3.curveMonotoneX);

        g.append('path').datum(seriesData).attr('d', awayArea).attr('fill', 'url(#d3-poss-away-grad)');
        g.append('path').datum(seriesData).attr('d', homeArea).attr('fill', 'url(#d3-poss-home-grad)');

        g.append('path')
          .datum(seriesData)
          .attr('d', dividerLine)
          .attr('fill', 'none')
          .attr('stroke', isDark ? '#ffffff' : '#0f172a')
          .attr('stroke-width', 2.2);

        g.selectAll('.wave-dot')
          .data(seriesData)
          .enter()
          .append('circle')
          .attr('cx', (d) => xScale(d.label) ?? 0)
          .attr('cy', (d) => yScale(d.homePossession))
          .attr('r', (_, idx) => (hoveredPossIndex === idx ? 5.5 : 3.8))
          .attr('fill', (d) => (d.homePossession >= 50 ? homeColor : awayColor))
          .attr('stroke', isDark ? '#171717' : '#ffffff')
          .attr('stroke-width', 2);

        // Hover guide
        if (hoveredPossIndex !== null && seriesData[hoveredPossIndex]) {
          const hx = xScale(seriesData[hoveredPossIndex].label) ?? 0;
          g.append('line')
            .attr('x1', hx)
            .attr('x2', hx)
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('stroke', dividerColor)
            .attr('stroke-width', 1.25);
        }

        const xAxis = d3.axisBottom(xScale).tickSize(0).tickPadding(12);
        g.append('g')
          .attr('transform', `translate(0,${innerHeight})`)
          .call(xAxis)
          .call((axis) => axis.select('.domain').attr('stroke', dividerColor))
          .selectAll('text')
          .attr('fill', axisTextColor)
          .attr('font-size', '11px')
          .attr('font-family', 'JetBrains Mono, monospace');

        const stepWidth = innerWidth / Math.max(1, seriesData.length);
        g.selectAll('.wave-hit')
          .data(seriesData)
          .enter()
          .append('rect')
          .attr('x', (d) => Math.max(0, (xScale(d.label) ?? 0) - stepWidth / 2))
          .attr('y', 0)
          .attr('width', stepWidth)
          .attr('height', innerHeight)
          .attr('fill', 'transparent')
          .style('cursor', 'crosshair')
          .on('mouseenter mousemove', (event, d) => {
            setHoveredPossIndex(seriesData.indexOf(d));
            const bounds = containerRef.current?.getBoundingClientRect();
            if (bounds) {
              setTooltipPos({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              });
            }
          })
          .on('mouseleave', () => setHoveredPossIndex(null));
      }

      // Y Axis (0% - 100%)
      const yAxis = d3
        .axisLeft(yScale)
        .tickValues([0, 25, 50, 75, 100])
        .tickSize(0)
        .tickPadding(10)
        .tickFormat((d) => `${d}%`);

      g.append('g')
        .call(yAxis)
        .call((axis) => axis.select('.domain').remove())
        .selectAll('text')
        .attr('fill', axisTextColor)
        .attr('font-size', '11px')
        .attr('font-family', 'JetBrains Mono, monospace');
    }
  }, [
    category,
    possessionStyle,
    visibleSeries,
    data,
    chartWidth,
    isDark,
    hoveredOddsIndex,
    hoveredPossIndex,
    seriesConfigs,
    match.status,
    match.liveMinute,
  ]);

  const hoveredOddsPoint = hoveredOddsIndex !== null ? data.oddsSeries[hoveredOddsIndex] : null;
  const hoveredPossPoint = hoveredPossIndex !== null ? data.possessionSeries[hoveredPossIndex] : null;

  const renderDelta = (current: number, opening: number) => {
    const diff = Number((current - opening).toFixed(2));
    if (Math.abs(diff) < 0.02) {
      return (
        <span className="inline-flex items-center gap-0.5 text-neutral-500 font-mono text-[11px]">
          <Minus className="w-3 h-3" />
          0.00
        </span>
      );
    }
    const isDrop = diff < 0;
    return (
      <span
        className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${
          isDrop ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {isDrop ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
        {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
      </span>
    );
  };

  return (
    <section className="bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 sm:p-5 space-y-4">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            {category === 'odds' ? (
              <LineChartIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            ) : (
              <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              {category === 'odds'
                ? 'Динамика коэффициентов по 15-минутным интервалам'
                : 'Статистика владения мячом по 15-минутным интервалам'}
            </h4>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            <span>Визуализация D3.js</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{match.homeTeam} — {match.awayTeam}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>
              {match.status === 'live'
                ? `Лайв ${match.liveMinute ?? 45}'`
                : match.status === 'finished'
                ? 'Итог 90 мин'
                : 'Предматчевый прогноз'}
            </span>
          </p>
        </div>

        {/* Primary Segmented Control: Odds vs Possession */}
        <div className="flex items-center gap-1 p-1 bg-neutral-200/70 dark:bg-neutral-800 rounded-lg self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setCategory('odds');
              setHoveredPossIndex(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              category === 'odds'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            Коэффициенты
          </button>
          <button
            type="button"
            onClick={() => {
              setCategory('possession');
              setHoveredOddsIndex(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              category === 'possession'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            Владение мячом (15')
          </button>
        </div>
      </div>

      {/* Sub-Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {category === 'odds' ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {seriesConfigs.map((s) => {
                const active = visibleSeries[s.key];
                const col = isDark ? s.darkColor : s.color;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleSeries(s.key)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-white'
                        : 'bg-transparent border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <span
                      className="w-2.5 h-0.5 inline-block rounded-full"
                      style={{ backgroundColor: col }}
                    />
                    <span>{s.shortLabel}</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {data.currentOdds[s.key].toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-neutral-500 inline-block" />
                Факт
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-neutral-400 inline-block" />
                Прогноз
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4 text-xs text-neutral-700 dark:text-neutral-300">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 dark:bg-blue-400 inline-block" />
                {match.homeTeam} ({data.avgHomePossession}%)
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-400 inline-block" />
                {match.awayTeam} ({data.avgAwayPossession}%)
              </span>
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-neutral-200/70 dark:bg-neutral-800 rounded-md">
              <button
                type="button"
                onClick={() => setPossessionStyle('bars')}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap ${
                  possessionStyle === 'bars'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                Столбцы 15'
              </button>
              <button
                type="button"
                onClick={() => setPossessionStyle('wave')}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap ${
                  possessionStyle === 'wave'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                Волна контроля
              </button>
            </div>
          </>
        )}
      </div>

      {/* D3 SVG Canvas Container */}
      <div ref={containerRef} className="relative w-full overflow-hidden">
        <svg ref={svgRef} className="w-full block select-none" role="img" aria-label="D3.js график динамики матча" />

        {/* Interactive Tooltip for Odds */}
        {category === 'odds' && hoveredOddsPoint && (
          <div
            className="pointer-events-none absolute z-20 bg-neutral-900/95 text-white border border-neutral-700 rounded-lg p-3 shadow-xl text-xs w-56 transition-opacity duration-100"
            style={{
              left: Math.min(Math.max(12, tooltipPos.x + 14), Math.max(12, chartWidth - 236)),
              top: Math.max(8, Math.min(tooltipPos.y - 20, 120)),
            }}
          >
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-neutral-800">
              <span className="font-bold text-neutral-100">
                {hoveredOddsPoint.id === 'pre' ? 'Открытие линии' : `Интервал ${hoveredOddsPoint.label}`}
              </span>
              <span className="font-mono text-[10px] text-neutral-400">
                {hoveredOddsPoint.isProjected ? 'Прогноз' : 'Линия'}
              </span>
            </div>

            <div className="space-y-1 font-mono tabular-nums">
              {seriesConfigs
                .filter((s) => visibleSeries[s.key])
                .map((s) => {
                  const val = hoveredOddsPoint[s.key];
                  const openVal = data.openingOdds[s.key];
                  const diff = Number((val - openVal).toFixed(2));
                  const implied = Math.round((1 / val) * 100);
                  return (
                    <div key={s.key} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1.5 text-neutral-300 truncate">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.darkColor }}
                        />
                        {s.shortLabel}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <strong className="text-white">{val.toFixed(2)}</strong>
                        <span className="text-neutral-400 text-[10px]">({implied}%)</span>
                        {hoveredOddsPoint.id !== 'pre' && diff !== 0 && (
                          <span
                            className={`text-[10px] ${
                              diff < 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
            </div>

            {hoveredOddsPoint.goalEventText && (
              <div className="mt-2 pt-1.5 border-t border-neutral-800 text-[11px] text-emerald-300 font-medium">
                Событие: {hoveredOddsPoint.goalEventText}
              </div>
            )}
          </div>
        )}

        {/* Interactive Tooltip for Possession */}
        {category === 'possession' && hoveredPossPoint && (
          <div
            className="pointer-events-none absolute z-20 bg-neutral-900/95 text-white border border-neutral-700 rounded-lg p-3 shadow-xl text-xs w-60 transition-opacity duration-100"
            style={{
              left: Math.min(Math.max(12, tooltipPos.x + 14), Math.max(12, chartWidth - 252)),
              top: Math.max(8, Math.min(tooltipPos.y - 20, 110)),
            }}
          >
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-neutral-800">
              <span className="font-bold text-neutral-100">Интервал {hoveredPossPoint.label}</span>
              <span className="font-mono text-[10px] text-neutral-400">
                {hoveredPossPoint.half === 1 ? '1-й тайм' : '2-й тайм'}
              </span>
            </div>

            <div className="space-y-1.5 font-mono tabular-nums text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-blue-300 truncate pr-2">{match.homeTeam}</span>
                <strong className="text-white">{hoveredPossPoint.homePossession}%</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-emerald-300 truncate pr-2">{match.awayTeam}</span>
                <strong className="text-white">{hoveredPossPoint.awayPossession}%</strong>
              </div>
              <div className="pt-1.5 mt-1 border-t border-neutral-800 flex items-center justify-between text-[10px] text-neutral-300">
                <span>Опасные атаки:</span>
                <span>
                  {hoveredPossPoint.homeDangerousAttacks} — {hoveredPossPoint.awayDangerousAttacks}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>Перевес контроля:</span>
                <span
                  className={
                    hoveredPossPoint.dominanceDelta >= 0 ? 'text-blue-300' : 'text-emerald-300'
                  }
                >
                  {hoveredPossPoint.dominanceDelta > 0
                    ? `+${hoveredPossPoint.dominanceDelta}% ${match.homeTeam}`
                    : hoveredPossPoint.dominanceDelta < 0
                    ? `+${Math.abs(hoveredPossPoint.dominanceDelta)}% ${match.awayTeam}`
                    : 'Равный (50/50)'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Summary Strip (Clean flat hairline-separated cells) */}
      {category === 'odds' ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
          {seriesConfigs.map((s) => {
            const openVal = data.openingOdds[s.key];
            const curVal = data.currentOdds[s.key];
            return (
              <div
                key={s.key}
                className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
              >
                <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="truncate font-medium">{s.label}</span>
                  {renderDelta(curVal, openVal)}
                </div>
                <div className="mt-1.5 flex items-baseline justify-between font-mono tabular-nums">
                  <span className="text-base font-bold text-neutral-900 dark:text-white">
                    {curVal.toFixed(2)}
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    старт {openVal.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              Среднее: {match.homeTeam}
            </div>
            <div className="mt-1 text-base font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
              {data.avgHomePossession}%
            </div>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              Среднее: {match.awayTeam}
            </div>
            <div className="mt-1 text-base font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {data.avgAwayPossession}%
            </div>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Пик контроля хозяев
            </div>
            <div className="mt-1 text-sm font-bold font-mono tabular-nums text-neutral-900 dark:text-white">
              {data.peakHomeInterval.label}{' '}
              <span className="text-blue-600 dark:text-blue-400">
                ({data.peakHomeInterval.homePossession}%)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Пик контроля гостей
            </div>
            <div className="mt-1 text-sm font-bold font-mono tabular-nums text-neutral-900 dark:text-white">
              {data.peakAwayInterval.label}{' '}
              <span className="text-emerald-600 dark:text-emerald-400">
                ({data.peakAwayInterval.awayPossession}%)
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
