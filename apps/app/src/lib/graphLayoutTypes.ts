/// The layout's shapes, apart from the layout itself, so eager modules can name them without
/// importing graphology.

export interface LayoutInput {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

export type Positions = Record<string, { x: number; y: number }>;

export type LayoutRunner = (input: LayoutInput) => Promise<Positions>;
