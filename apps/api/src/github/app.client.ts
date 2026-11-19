import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { readFile } from 'node:fs/promises'
import type { App } from 'octokit'

@Injectable()
export class GitHubAppClient {
  private readonly clients = new Map<string, ReturnType<App['getInstallationOctokit']>>()

  installationClient(installationId: string) {
    let client = this.clients.get(installationId)
    if (!client) {
      client = this.createInstallationClient(installationId)
      this.clients.set(installationId, client)
      void client.catch(() => this.clients.delete(installationId))
    }
    return client
  }

  private async createInstallationClient(installationId: string) {
    const appId = process.env.GITHUB_APP_ID, path = process.env.GITHUB_APP_PRIVATE_KEY_PATH
    if (!appId || !path) throw new ServiceUnavailableException('GitHub App is not configured')
    const { App, Octokit } = await import('octokit')
    const app = new App({ appId, privateKey: await readFile(path, 'utf8'), Octokit: Octokit.defaults({
      log: { debug() {}, info() {}, warn() {}, error() {} }, request: { timeout: 15000 },
      throttle: { enabled: false }, retry: { enabled: false },
    }) })
    return app.getInstallationOctokit(Number(installationId))
  }

  async findInstallation(fullName: string) {
    const appId = process.env.GITHUB_APP_ID, path = process.env.GITHUB_APP_PRIVATE_KEY_PATH
    if (!appId || !path) throw new ServiceUnavailableException('GitHub App is not configured')
    try {
      const { App, Octokit } = await import('octokit')
      const app = new App({ appId, privateKey: await readFile(path, 'utf8'), Octokit: Octokit.defaults({
        log: { debug() {}, info() {}, warn() {}, error() {} }, request: { timeout: 10000 },
      }) })
      const [owner, repo] = fullName.split('/')
      const installation = await app.octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo })
      return String(installation.data.id)
    } catch (error) {
      const status = (error as { status?: number }).status
      throw new ServiceUnavailableException(status === 404
        ? 'Установите TeamPulse Insights на этот репозиторий и проверьте его название.'
        : 'GitHub временно недоступен или ограничил запросы. Попробуйте подключить репозиторий позже.')
    }
  }
  async verifyRepository(installationId: string, fullName: string, githubId: string) {
    const appId = process.env.GITHUB_APP_ID, path = process.env.GITHUB_APP_PRIVATE_KEY_PATH
    if (!appId || !path) throw new ServiceUnavailableException('GitHub App is not configured')
    try {
      const { App } = await import('octokit')
      const app = new App({ appId, privateKey: await readFile(path, 'utf8'),
        Octokit: (await import('octokit')).Octokit.defaults({ log: { debug() {}, info() {}, warn() {}, error() {} },
          request: { timeout: 10000 } }) })
      const installation = await app.octokit.request('GET /app/installations/{installation_id}', {
        installation_id: Number(installationId),
      })
      if (installation.data.suspended_at || Object.values(installation.data.permissions).some(value => value === 'write')
        || !['contents', 'issues', 'pull_requests'].every(key =>
          (installation.data.permissions as Record<string, string>)[key] === 'read')) {
        throw new ForbiddenException('Проверьте установку TeamPulse Insights: нужны только права чтения кода, issues и pull requests; установка не должна быть приостановлена.')
      }
      const octokit = await app.getInstallationOctokit(Number(installationId))
      const [owner, repo] = fullName.split('/')
      const repository = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo })
      const admins = await octokit.paginate('GET /repos/{owner}/{repo}/collaborators', {
        owner, repo, permission: 'admin', per_page: 100,
      })
      if (!admins.some(user => String(user.id) === githubId)) throw new ForbiddenException('Подключить репозиторий должен его администратор GitHub.')
      return { externalId: String(repository.data.id), fullName: repository.data.full_name }
    } catch (error) {
      if (error instanceof ForbiddenException) throw error
      throw new ServiceUnavailableException('Не удалось проверить доступ GitHub. Проверьте установку TeamPulse Insights и доступ к репозиторию, затем повторите подключение.')
    }
  }
}
