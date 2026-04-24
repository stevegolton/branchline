import type { Workspace } from "./workspace";

export function createFigureOfEight(): Workspace {
  return {
    tracks: [
      {
        id: crypto.randomUUID(),
        kind: "c1",
        position: { x: 800, y: 600 },
        orientation: 0,
        docked: [
          {
            id: crypto.randomUUID(),
            kind: "c1",
            docked: [
              {
                id: crypto.randomUUID(),
                kind: "c1",
                docked: [
                  {
                    id: crypto.randomUUID(),
                    kind: "c1",
                    docked: [
                      {
                        id: crypto.randomUUID(),
                        kind: "c1",
                        docked: [
                          {
                            id: crypto.randomUUID(),
                            kind: "c1",
                            docked: [
                              {
                                id: crypto.randomUUID(),
                                kind: "a1",
                                docked: [
                                  {
                                    id: crypto.randomUUID(),
                                    kind: "a1",
                                    docked: [
                                      {
                                        id: crypto.randomUUID(),
                                        kind: "c1",
                                        flipped: true,
                                        docked: [
                                          {
                                            id: crypto.randomUUID(),
                                            kind: "c1",
                                            flipped: true,
                                            docked: [
                                              {
                                                id: crypto.randomUUID(),
                                                kind: "c1",
                                                flipped: true,
                                                docked: [
                                                  {
                                                    id: crypto.randomUUID(),
                                                    kind: "c1",
                                                    flipped: true,
                                                    docked: [
                                                      {
                                                        id: crypto.randomUUID(),
                                                        kind: "c1",
                                                        flipped: true,
                                                        docked: [
                                                          {
                                                            id: crypto.randomUUID(),
                                                            kind: "c1",
                                                            flipped: true,
                                                            docked: [
                                                              {
                                                                id: crypto.randomUUID(),
                                                                kind: "a1",
                                                                docked: [
                                                                  {
                                                                    id: crypto.randomUUID(),
                                                                    kind: "a1",
                                                                  },
                                                                ],
                                                              },
                                                            ],
                                                          },
                                                        ],
                                                      },
                                                    ],
                                                  },
                                                ],
                                              },
                                            ],
                                          },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
