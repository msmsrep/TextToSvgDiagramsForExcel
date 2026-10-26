export type Template = {
  id: string;
  label: string;
  code: string;
};

/** Starting code for each diagram type, offered in the template dropdown. */
export const TEMPLATES: readonly Template[] = [
  {
    id: "flowchart",
    label: "Flowchart",
    code: `graph TD
    A[Start] --> B{Condition}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E`,
  },
  {
    id: "sequence",
    label: "Sequence",
    code: `sequenceDiagram
    participant User
    participant System
    User->>System: Request
    System-->>User: Response`,
  },
  {
    id: "class",
    label: "Class",
    code: `classDiagram
    class Animal {
        +String name
        +move()
    }
    class Dog {
        +bark()
    }
    Animal <|-- Dog`,
  },
  {
    id: "state",
    label: "State",
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review : submit
    Review --> Draft : reject
    Review --> Done : approve
    Done --> [*]`,
  },
  {
    id: "er",
    label: "Entity relationship",
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    CUSTOMER {
        int id
        string name
    }
    ORDER {
        int id
        date ordered_on
    }`,
  },
  {
    id: "gantt",
    label: "Gantt",
    code: `gantt
    dateFormat YYYY-MM-DD
    section Plan
    Design :a1, 2026-01-05, 5d
    section Build
    Develop :a2, after a1, 10d
    Test :after a2, 5d`,
  },
  {
    id: "pie",
    label: "Pie",
    code: `pie
    "A" : 40
    "B" : 35
    "C" : 25`,
  },
  {
    id: "mindmap",
    label: "Mindmap",
    code: `mindmap
  root((Topic))
    Idea A
      Detail 1
      Detail 2
    Idea B`,
  },
  {
    id: "timeline",
    label: "Timeline",
    code: `timeline
    2024 : Planning
    2025 : Development
    2026 : Release`,
  },
];
