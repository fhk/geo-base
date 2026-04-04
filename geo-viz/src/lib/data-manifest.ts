export interface DemoFile {
	filename: string;
	label: string;
	group: string;
}

export const demoFiles: DemoFile[] = [
	{
		filename: 'sample_a.csv',
		label: 'Sample A',
		group: 'Demo'
	},
	{
		filename: 'sample_b.csv',
		label: 'Sample B',
		group: 'Demo'
	}
];

export function getDemoFiles(): DemoFile[] {
	return demoFiles;
}

export function getDemoGroups(): string[] {
	return [...new Set(demoFiles.map((f) => f.group))].sort();
}
