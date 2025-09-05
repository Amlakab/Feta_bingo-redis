import { IBingoCard } from '../models/BingoCard';

export const checkBingo = (markedNumbers: number[], card: number[][]): string | null => {
  const size = 5;
  
  // Check rows
  for (let row = 0; row < size; row++) {
    if (card[row].every((num, col) => col === 2 && row === 2 ? true : markedNumbers.includes(num))) {
      return `row-${row + 1}`;
    }
  }
  
  // Check columns
  for (let col = 0; col < size; col++) {
    if (card.every((row, rowIdx) => rowIdx === 2 && col === 2 ? true : markedNumbers.includes(row[col]))) {
      return `col-${col + 1}`;
    }
  }
  
  // Check diagonal top-left to bottom-right
  if (card.every((row, idx) => idx === 2 ? true : markedNumbers.includes(row[idx]))) {
    return 'diagonal-1';
  }
  
  // Check diagonal top-right to bottom-left
  if (card.every((row, idx) => idx === 2 ? true : markedNumbers.includes(row[4 - idx]))) {
    return 'diagonal-2';
  }
  
  // Check four corners
  if (
    markedNumbers.includes(card[0][0]) &&
    markedNumbers.includes(card[0][4]) &&
    markedNumbers.includes(card[4][0]) &&
    markedNumbers.includes(card[4][4])
  ) {
    return 'four-corners';
  }
  
  return null;
};

export const generateBingoCard = (): number[][] => {
  const card: number[][] = [];
  const usedNumbers = new Set<number>();
  
  for (let col = 0; col < 5; col++) {
    const column: number[] = [];
    const min = col * 15 + 1;
    const max = min + 14;
    
    while (column.length < 5) {
      const num = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!usedNumbers.has(num)) {
        column.push(num);
        usedNumbers.add(num);
      }
    }
    
    card.push(column);
  }
  
  // Free space in the center
  card[2][2] = 0;
  
  return card;
};

export const calculatePrize = (gameCardCount: number, cardPrice: number): number => {
  // 80% of total sales as prize, 20% as platform fee
  const totalSales = gameCardCount * cardPrice;
  return totalSales * 0.8;
};