import { Icon } from '../shell/Icon';
import { TemplateThumbnail } from './TemplateThumbnail';
import type { Template } from './registry';

export function TemplateCard({
  template,
  size = 'md',
  onPick,
}: {
  template: Template;
  size?: 'md' | 'lg';
  onPick: (t: Template) => void;
}) {
  return (
    <button
      type="button"
      className={`tpl-card tpl-card--${size}`}
      data-template-id={template.id}
      data-testid={`tpl-card-${template.id}`}
      style={{ ['--tpl-accent' as string]: template.accent }}
      onClick={() => onPick(template)}
    >
      <div className="tpl-card__preview">
        <TemplateThumbnail template={template} />
      </div>
      <div className="tpl-card__body">
        <div className="tpl-card__icon">
          <Icon name={template.icon} />
        </div>
        <div className="tpl-card__text">
          <div className="tpl-card__name">{template.name}</div>
          <div className="tpl-card__category">{template.category}</div>
        </div>
      </div>
    </button>
  );
}
