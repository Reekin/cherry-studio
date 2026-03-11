import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgentRemote } from '@renderer/hooks/useAgentRemote'
import { Button, Input, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '.'

const normalizeValue = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const RemoteSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { status, isLoading, refresh } = useAgentRemote()
  const [relayUrl, setRelayUrl] = useState('')
  const [sharedKey, setSharedKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadConfig = async () => {
      const [storedRelayUrl, storedSharedKey] = await Promise.all([
        window.api.config.get('remoteRelayUrl'),
        window.api.config.get('remoteSharedKey')
      ])

      if (cancelled) {
        return
      }

      setRelayUrl(typeof storedRelayUrl === 'string' ? storedRelayUrl : '')
      setSharedKey(typeof storedSharedKey === 'string' ? storedSharedKey : '')
    }

    void loadConfig()

    return () => {
      cancelled = true
    }
  }, [])

  const statusTag = useMemo(() => {
    if (!status.enabled) {
      return <Tag color="orange">{t('settings.remote.status.offline', { defaultValue: 'Offline' })}</Tag>
    }

    if (status.bridgeOnline) {
      return <Tag color="green">{t('settings.remote.status.connected', { defaultValue: 'Connected' })}</Tag>
    }

    return <Tag color="orange">{t('settings.remote.status.offline', { defaultValue: 'Offline' })}</Tag>
  }, [status.bridgeOnline, status.enabled, t])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await Promise.all([
        window.api.config.set('remoteRelayUrl', normalizeValue(relayUrl)),
        window.api.config.set('remoteSharedKey', normalizeValue(sharedKey))
      ])

      await refresh()
      window.toast.success(t('settings.remote.save.success', { defaultValue: 'Remote settings saved.' }))
    } catch (error) {
      window.toast.error({
        title: t('settings.remote.save.failed', { defaultValue: 'Failed to save remote settings.' }),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.remote.title', { defaultValue: 'Remote' })}
          {statusTag}
        </SettingTitle>
        <SettingDescription>
          {t('settings.remote.description', {
            defaultValue: 'Configure the relay endpoint and shared key used by Cherry Remote.'
          })}
        </SettingDescription>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.remote.relayUrl', { defaultValue: 'Relay URL' })}</SettingRowTitle>
          <Input
            spellCheck={false}
            value={relayUrl}
            onChange={(event) => setRelayUrl(event.target.value)}
            placeholder="wss://relay.example.com/ws/desktop"
            style={{ width: 320 }}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.remote.sharedKey', { defaultValue: 'Shared Key' })}</SettingRowTitle>
          <Input.Password
            spellCheck={false}
            value={sharedKey}
            onChange={(event) => setSharedKey(event.target.value)}
            placeholder={t('settings.remote.sharedKey.placeholder', { defaultValue: 'Enter relay shared key' })}
            style={{ width: 320 }}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.remote.currentState', { defaultValue: 'Bridge State' })}</SettingRowTitle>
          <span className="text-[var(--color-text-2)] text-sm">
            {isLoading ? t('common.loading', { defaultValue: 'Loading...' }) : (status.lastError ?? status.state)}
          </span>
        </SettingRow>
        <div className="mt-4 flex justify-end">
          <Button type="primary" loading={isSaving} onClick={() => void handleSave()}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </SettingGroup>
    </SettingContainer>
  )
}

export default RemoteSettings
