import * as fs from 'fs';
import * as core from '@actions/core';
import * as Octokit from '@octokit/rest';
import defaultChangelogOpts from 'conventional-changelog-angular/conventional-recommended-bump';

export const getShortSHA = (sha: string): string => {
  const coreAbbrev = 7;
  return sha.substring(0, coreAbbrev);
};

export type ParsedCommitsExtraCommit = Octokit.ReposCompareCommitsResponseCommitsItem & {
  author: {
    email: string;
    name: string;
    username: string;
  };
  committer: {
    email: string;
    name: string;
    username: string;
  };
  distinct: boolean;
  id: string;
  message: string;
  timestamp: string;
  tree_id: string;
  url: string;
};

type ParsedCommitsExtra = {
  commit: ParsedCommitsExtraCommit;
  pullRequests: {
    number: number;
    url: string;
  }[];
  breakingChange: boolean;
};

type Contributor = { login: string; name: string; url: string; avatar: string };

enum ConventionalCommitTypes {
  feat = '✨ Features',
  fix = '🐛 Bug Fixes ',
  docs = '📝 Documentation',
  style = '🎨 Styles',
  refactor = '♻️ Code Refactoring',
  perf = '🚀 Performance Improvements',
  test = '✅ Tests',
  build = '👷 Builds',
  ci = '💚 Continuous Integration',
  chore = '🔨 Chores',
  revert = '⏪️ Reverts',
}

export type ParsedCommits = {
  type: ConventionalCommitTypes;
  scope: string;
  subject: string;
  merge: string;
  header: string;
  body: string;
  footer: string;
  notes: {
    title: string;
    text: string;
  }[];
  extra: ParsedCommitsExtra;
  references: {
    action: string;
    owner: string;
    repository: string;
    issue: string;
    raw: string;
    prefix: string;
  }[];
  mentions: string[];
  revert: boolean;
};

const getFormattedChangelogEntry = (parsedCommit: ParsedCommits): string => {
  let entry = '';

  const url = parsedCommit.extra.commit.html_url;
  const sha = getShortSHA(parsedCommit.extra.commit.sha);
  const author = parsedCommit.extra.commit.commit.author.name;

  let prString = '';
  prString = parsedCommit.extra.pullRequests.reduce((acc, pr) => {
    // e.g. #1
    // e.g. #1,#2
    // e.g. ''
    if (acc) {
      acc += ',';
    }
    return `${acc}[#${pr.number}](${pr.url})`;
  }, '');
  if (prString) {
    prString = ' ' + prString;
  }

  entry = `- ${sha}: ${parsedCommit.header} (${author})${prString}`;
  if (parsedCommit.type) {
    const scopeStr = parsedCommit.scope ? `**${parsedCommit.scope}**: ` : '';
    entry = `- ${scopeStr}${parsedCommit.subject}${prString} ([${author}](${url}))`;
  }

  return entry;
};

const getRenderedContributors = (contributors: Contributor[], style: 'table' | 'list'): string => {
  let content = '';

  if (style === 'table') {
    content = '<table>\n';

    const columns = 5;
    const rows = Math.ceil(contributors.length / columns);

    for (let row = 1; row <= rows; row++) {
      content += '<tr>';

      for (let column = 1; column <= columns && (row - 1) * columns + column - 1 < contributors.length; column++) {
        const contributor = contributors[(row - 1) * columns + column - 1];

        content += `<td align="center">
          <a href="https://github.com/${contributor.login}">
              <img src="${contributor.avatar}" width="150px;" alt="${contributor.login}"/>
              <br />
              <sub><b>${contributor.name ? contributor.name : contributor.login}</b></sub>
          </a>
        </td>`;
      }

      content += '</tr>\n';
    }
    content += '</table>';
  } else if (style === 'list') {
    content += '<ul class="list-style-none d-flex flex-wrap mb-n2">\n';
    for (const contributor of contributors) {
      content += `<li class="mb-2 mr-2">
        <a href="https://github.com/${contributor.login}" data-hovercard-type="user" data-hovercard-url="/users/${contributor.login}/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self">
          <img src="${contributor.avatar}" size="32" height="32" width="32" class="avatar circle" alt="@${contributor.login}" />
        </a>
      </li>`;
    }
    content += '</ul>';
  }

  return content;
};

export const generateChangelogFromParsedCommits = (parsedCommits: ParsedCommits[]): string => {
  let changelog = '';

  // Breaking Changes
  const breaking = parsedCommits
    .filter((val) => val.extra.breakingChange === true)
    .map((val) => getFormattedChangelogEntry(val))
    .reduce((acc, line) => `${acc}\n${line}`, '');
  if (breaking) {
    changelog += '## 💥💥 Breaking Changes 💥💥\n';
    changelog += breaking.trim();
  }

  for (const key of Object.keys(ConventionalCommitTypes)) {
    const clBlock = parsedCommits
      .filter((val) => val.type === key)
      .map((val) => getFormattedChangelogEntry(val))
      .reduce((acc, line) => `${acc}\n${line}`, '');
    if (clBlock) {
      changelog += `\n\n## ${ConventionalCommitTypes[key]}\n`;
      changelog += clBlock.trim();
    }
  }

  // Commits
  const commits = parsedCommits
    .filter((val) => val.type === null || Object.keys(ConventionalCommitTypes).indexOf(val.type) === -1)
    .map((val) => getFormattedChangelogEntry(val))
    .reduce((acc, line) => `${acc}\n${line}`, '');
  if (commits) {
    changelog += '\n\n## Commits\n';
    changelog += commits.trim();
  }

  // Contributors
  let contributors: Contributor[] = [];
  for (const commit of parsedCommits) {
    let author = commit.extra.commit.author ?? commit.extra.commit.committer;

    // no author... skip
    if (author === null) {
      continue;
    }

    let authorItem = {
      login: author.login,
      name: author.name,
      url: author.url,
      avatar: author.avatar_url,
    };

    if (contributors.find((val) => val.login !== authorItem.login)) {
      contributors.push(authorItem);
    }
  }

  if (contributors.length > 0) {
    changelog += '\n\n## Contributors\n';
    changelog += getRenderedContributors(contributors, 'list');
  }

  return changelog.trim();
};

export const isBreakingChange = ({ body, footer }: { body: string; footer: string }): boolean => {
  const re = /^BREAKING\s+CHANGES?:\s+/;
  return re.test(body || '') || re.test(footer || '');
};

export const parseGitTag = (inputRef: string): string => {
  const re = /^(refs\/)?tags\/(.*)$/;
  const resMatch = inputRef.match(re);
  if (!resMatch || !resMatch[2]) {
    core.debug(`Input "${inputRef}" does not appear to be a tag`);
    return '';
  }
  return resMatch[2];
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const getChangelogOptions = async () => {
  const defaultOpts = defaultChangelogOpts;
  defaultOpts['mergePattern'] = '^Merge pull request #(.*) from (.*)$';
  defaultOpts['mergeCorrespondence'] = ['issueId', 'source'];
  core.debug(`Changelog options: ${JSON.stringify(defaultOpts)}`);
  return defaultOpts;
};

export const dumpGitHubEventPayload = (): void => {
  const ghpath: string = process.env['GITHUB_EVENT_PATH'] || '';
  if (!ghpath) {
    throw new Error('Environment variable GITHUB_EVENT_PATH does not appear to be set.');
  }
  const contents = fs.readFileSync(ghpath, 'utf8');
  const jsonContent = JSON.parse(contents);
  core.info(`GitHub payload: ${JSON.stringify(jsonContent)}`);
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const octokitLogger = (...args): string => {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }

      const argCopy = { ...arg };

      // Do not log file buffers
      if (argCopy.file) {
        argCopy.file = '== raw file buffer info removed ==';
      }
      if (argCopy.data) {
        argCopy.data = '== raw file buffer info removed ==';
      }

      return JSON.stringify(argCopy);
    })
    .reduce((acc, val) => `${acc} ${val}`, '');
};
