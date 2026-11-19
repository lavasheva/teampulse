import type { CollectedEventResponse, ProjectAuditAction } from '@teampulse/shared'
export const eventLabels: Record<CollectedEventResponse['kind'], string> = {
  commit: 'Коммит', pr_opened: 'Открыт PR', pr_merged: 'Слит PR', pr_closed: 'Закрыт PR', review: 'Ревью',
  issue_opened: 'Открыта задача', issue_closed: 'Закрыта задача',
}
export const auditLabels: Record<ProjectAuditAction, string> = {
  manager_added: 'Назначен руководитель', manager_removed: 'Сняты права руководителя', member_role_changed: 'Изменена роль',
  member_removed: 'Удалён участник', member_joined: 'Вступление в команду', invitation_created: 'Создано приглашение',
  invitation_revoked: 'Отозвано приглашение', repository_connected: 'Подключён репозиторий', repository_reconnected: 'Восстановлено подключение',
  repository_disconnected: 'Отключён репозиторий', settings_updated: 'Сохранены настройки', identity_claimed: 'Подтверждено авторство',
}
export const roleLabel = (role: string) => ({ participant: 'участник', observer: 'наблюдатель' })[role] ?? role
