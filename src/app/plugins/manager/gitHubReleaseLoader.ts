interface GitHubRelease {
    tag_name: string;
    name: string;
    html_url: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
        content_type: string;
    }>;
}

export class GitHubReleaseLoader {
    static async fetchLatestRelease(repoUrl: string): Promise<GitHubRelease | null> {
        const { owner, repo } = this.parseGitHubUrl(repoUrl);
        if (!owner || !repo) return null;

        try {
            const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
            if (!response.ok) return null;
            
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch latest release:', error);
            return null;
        }
    }

    static getReleasePageUrl(release: GitHubRelease): string {
        return release.html_url;
    }

    static parseGitHubUrl(url: string): { owner: string; repo: string } | { owner: null; repo: null } {
        const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (!match) return { owner: null, repo: null };
        
        return {
            owner: match[1],
            repo: match[2]
        };
    }

    static parseVersion(versionString: string): string {
        return versionString.replace(/^v/, '');
    }

    static compareVersions(current: string, latest: string): number {
        const currentParts = current.split('.').map(Number);
        const latestParts = latest.split('.').map(Number);

        for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
            const currentPart = currentParts[i] || 0;
            const latestPart = latestParts[i] || 0;

            if (currentPart < latestPart) return -1;
            if (currentPart > latestPart) return 1;
        }

        return 0;
    }
}
