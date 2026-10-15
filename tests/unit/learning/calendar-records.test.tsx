import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MonthCalendar } from '@/features/calendar/month-calendar';
afterEach(cleanup);
it('counts only completed days and addresses same-mode records by ID',()=>{
 const onSelectRecord=vi.fn();const shared={date:'2026-10-15',entryMode:'manual' as const,version:1,updatedAt:'2026-10-15T00:00:00Z',hasImage:false};
 render(<MonthCalendar month="2026-10" selectedDate="2026-10-15" today="2026-10-15" summaries={[{...shared,id:'a',attention:'A',status:'pending'},{...shared,id:'b',attention:'B',status:'pending'}]} onMonthChange={vi.fn()} onSelectDate={vi.fn()} onSelectRecord={onSelectRecord}/>);
 expect(screen.queryByText('1 天')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:/10月15日/})).toHaveAccessibleName(/2 条记录/);
 fireEvent.click(within(screen.getByRole('region',{name:'10月15日的收获'})).getByRole('button',{name:'查看记录 B'}));
 expect(onSelectRecord).toHaveBeenCalledWith('b');
});
