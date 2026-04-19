export interface Letter {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  recipient: string;
  content: string;
  mood?: string;
  weather?: string;
  authorId?: string;
}

export interface AppData {
  letters: Letter[];
  firstLoginAt: number;
}
